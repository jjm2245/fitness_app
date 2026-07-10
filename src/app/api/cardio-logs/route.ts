import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, cardioLogs } from "@/db/schema";

interface CardioPayload {
  date: string;
  exerciseId: string;
  durationMin?: number | null;
  incline?: number | null;
  speed?: number | null;
  distance?: number | null;
  level?: number | null;
  notes?: string | null;
}

const num = (v: number | null | undefined) => (v == null ? null : v.toString());

export async function POST(request: NextRequest) {
  const body: CardioPayload = await request.json();
  if (!body.date || !body.exerciseId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    let [workoutLog] = await tx.select().from(workoutLogs).where(eq(workoutLogs.date, body.date));
    if (!workoutLog) {
      [workoutLog] = await tx.insert(workoutLogs).values({ date: body.date }).returning();
    }
    const [row] = await tx
      .insert(cardioLogs)
      .values({
        workoutLogId: workoutLog.id,
        exerciseId: body.exerciseId,
        durationMin: num(body.durationMin),
        incline: num(body.incline),
        speed: num(body.speed),
        distance: num(body.distance),
        level: num(body.level),
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
