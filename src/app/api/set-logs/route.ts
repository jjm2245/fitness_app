import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, setLogs } from "@/db/schema";

interface SetLogPayload {
  date: string; // ISO date, e.g. "2026-07-04"
  programDay?: string | null;
  exerciseId: string;
  machineId?: string | null;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  rir?: number | null;
  romNote?: string | null;
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  const body: SetLogPayload = await request.json();

  if (!body.date || !body.exerciseId || body.load == null || body.reps == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    let [workoutLog] = await tx
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.date, body.date));

    if (!workoutLog) {
      [workoutLog] = await tx
        .insert(workoutLogs)
        .values({ date: body.date, programDay: body.programDay ?? null })
        .returning();
    }

    const [setLog] = await tx
      .insert(setLogs)
      .values({
        workoutLogId: workoutLog.id,
        exerciseId: body.exerciseId,
        machineId: body.machineId ?? null,
        setIndex: body.setIndex,
        setType: body.setType,
        load: body.load.toString(),
        reps: body.reps,
        rir: body.rir != null ? body.rir.toString() : null,
        romNote: body.romNote ?? null,
        notes: body.notes ?? null,
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
