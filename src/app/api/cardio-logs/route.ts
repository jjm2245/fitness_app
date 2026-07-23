import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, cardioLogs, sessionExercises } from "@/db/schema";

interface CardioPayload {
  clientSessionId?: string | null;
  instanceId?: string | null;
  date: string;
  exerciseId: string;
  durationMin?: number | null;
  incline?: number | null;
  speed?: number | null;
  distance?: number | null;
  level?: number | null;
  // Mixed logging (Phase 2): optional load + effort tag (set_logs' enum values).
  load?: number | null;
  effort?: string | null;
  notes?: string | null;
}

const EFFORT_VALUES = new Set(["more_in_me", "near_failure", "to_failure"]);

const num = (v: number | null | undefined) => (v == null ? null : v.toString());

export async function POST(request: NextRequest) {
  const body: CardioPayload = await request.json();
  if (!body.date || !body.exerciseId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    // Upsert the workout_log by client session id (falling back to date for
    // legacy callers), matching set-logs.
    let [workoutLog] = body.clientSessionId
      ? await tx.select().from(workoutLogs).where(eq(workoutLogs.clientSessionId, body.clientSessionId))
      : await tx.select().from(workoutLogs).where(eq(workoutLogs.date, body.date));
    if (!workoutLog) {
      [workoutLog] = await tx
        .insert(workoutLogs)
        .values({ date: body.date, clientSessionId: body.clientSessionId ?? null })
        .returning();
    }
    let sessionExerciseId: number | null = null;
    if (body.instanceId) {
      const [occ] = await tx
        .select({ id: sessionExercises.id })
        .from(sessionExercises)
        .where(eq(sessionExercises.clientInstanceId, body.instanceId));
      sessionExerciseId = occ?.id ?? null;
    }
    const [row] = await tx
      .insert(cardioLogs)
      .values({
        workoutLogId: workoutLog.id,
        sessionExerciseId,
        exerciseId: body.exerciseId,
        durationMin: num(body.durationMin),
        incline: num(body.incline),
        speed: num(body.speed),
        distance: num(body.distance),
        level: num(body.level),
        load: num(body.load),
        effort: body.effort && EFFORT_VALUES.has(body.effort) ? (body.effort as "more_in_me" | "near_failure" | "to_failure") : null,
        notes: body.notes ?? null,
      })
      .returning();
    return row;
  });

  return NextResponse.json(result, { status: 201 });
}

export async function GET() {
  const rows = await db
    .select({
      id: cardioLogs.id,
      date: workoutLogs.date,
      exerciseId: cardioLogs.exerciseId,
      durationMin: cardioLogs.durationMin,
      incline: cardioLogs.incline,
      speed: cardioLogs.speed,
      distance: cardioLogs.distance,
      level: cardioLogs.level,
    })
    .from(cardioLogs)
    .innerJoin(workoutLogs, eq(cardioLogs.workoutLogId, workoutLogs.id))
    .orderBy(workoutLogs.date);
  return NextResponse.json(rows);
}
