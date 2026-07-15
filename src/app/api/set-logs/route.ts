import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, setLogs, machines, sessionExercises, exerciseMachines } from "@/db/schema";

interface SetLogPayload {
  clientSessionId?: string | null;
  instanceId?: string | null; // the performed occurrence (v2)
  date: string; // ISO date, e.g. "2026-07-04"
  programDay?: string | null;
  exerciseId: string;
  machineId?: string | null;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  effort?: "more_in_me" | "near_failure" | "to_failure" | null;
  rir?: number | null;
  romNote?: string | null;
  notes?: string | null;
  // Logging depth (all optional; absent = legacy client):
  loggedAt?: string | null; // client-stamped ISO instant
  restSeconds?: number | null; // null = unknown (never fabricated)
  restSource?: "timed" | "derived" | "user" | null;
  dropSetGroup?: string | null;
  side?: "left" | "right" | "both" | null;
  loadEntered?: number | null;
  builtinOffset?: number | null;
}

const REST_SOURCES = new Set(["timed", "derived", "user"]);
const SIDES = new Set(["left", "right", "both"]);

export async function POST(request: NextRequest) {
  const body: SetLogPayload = await request.json();

  if (!body.date || !body.exerciseId || body.load == null || body.reps == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    // A workout_log maps to a client session; upsert by that id (falling back
    // to date for legacy callers without one).
    let [workoutLog] = body.clientSessionId
      ? await tx.select().from(workoutLogs).where(eq(workoutLogs.clientSessionId, body.clientSessionId))
      : await tx.select().from(workoutLogs).where(eq(workoutLogs.date, body.date));

    if (!workoutLog) {
      [workoutLog] = await tx
        .insert(workoutLogs)
        .values({ date: body.date, programDay: body.programDay ?? null, clientSessionId: body.clientSessionId ?? null })
        .returning();
    }

    // Machine/Smith/cable loads are context-bound (spec §9) — auto-register a bare
    // machine row on first use rather than requiring a separate "add machine" step
    // before logging is possible. Users can enrich brand/pulley-ratio/etc. later.
    if (body.machineId) {
      await tx.insert(machines).values({ id: body.machineId }).onConflictDoNothing();
      // Curate the machine under this exercise (Part 3c) — builds the per-
      // exercise machine list automatically from real use.
      await tx
        .insert(exerciseMachines)
        .values({ exerciseId: body.exerciseId, machineId: body.machineId })
        .onConflictDoNothing();
    }

    // Link the set to its performed occurrence (v2). Occurrences sync before
    // sets, so this normally resolves; null if the client sent no instance.
    let sessionExerciseId: number | null = null;
    if (body.instanceId) {
      const [occ] = await tx
        .select({ id: sessionExercises.id })
        .from(sessionExercises)
        .where(eq(sessionExercises.clientInstanceId, body.instanceId));
      sessionExerciseId = occ?.id ?? null;
    }

    const [setLog] = await tx
      .insert(setLogs)
      .values({
        workoutLogId: workoutLog.id,
        sessionExerciseId,
        exerciseId: body.exerciseId,
        machineId: body.machineId ?? null,
        setIndex: body.setIndex,
        setType: body.setType,
        load: body.load.toString(),
        reps: body.reps,
        effort: body.effort ?? null,
        rir: body.rir != null ? body.rir.toString() : null,
        romNote: body.romNote ?? null,
        notes: body.notes ?? null,
        loggedAt: body.loggedAt ? new Date(body.loggedAt) : null,
        restSeconds: body.restSeconds ?? null,
        restSource: body.restSource && REST_SOURCES.has(body.restSource) ? body.restSource : null,
        dropSetGroup: body.dropSetGroup ?? null,
        side: body.side && SIDES.has(body.side) ? body.side : null,
        loadEntered: body.loadEntered != null ? body.loadEntered.toString() : null,
        builtinOffset: body.builtinOffset != null ? body.builtinOffset.toString() : null,
      })
      .returning();

    return setLog;
  });

  return NextResponse.json(result, { status: 201 });
}

export async function GET() {
  const rows = await db
    .select({
      id: setLogs.id,
      date: workoutLogs.date,
      exerciseId: setLogs.exerciseId,
      machineId: setLogs.machineId,
      setType: setLogs.setType,
      load: setLogs.load,
      reps: setLogs.reps,
      rir: setLogs.rir,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .orderBy(workoutLogs.date);

  return NextResponse.json(rows);
}
