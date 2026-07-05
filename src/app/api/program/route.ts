import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { programs, programExercises, exercises } from "@/db/schema";

// Fixed display order for the current routine's day tags; anything else sorts
// alphabetically after these (keeps the day picker predictable in the UI).
const DAY_ORDER = ["legs_shoulders", "chest_triceps", "back_biceps", "abs", "cardio"];

function dayRank(day: string): number {
  const idx = DAY_ORDER.indexOf(day);
  return idx === -1 ? DAY_ORDER.length : idx;
}

export async function GET() {
  const [program] = await db.select().from(programs).where(eq(programs.active, true));
  if (!program) {
    return NextResponse.json({ error: "No active program" }, { status: 404 });
  }

  const rows = await db
    .select({
      day: programExercises.day,
      orderIndex: programExercises.orderIndex,
      targetSets: programExercises.targetSets,
      repRange: programExercises.repRange,
      rirTarget: programExercises.rirTarget,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      conditioningOnly: exercises.conditioningOnly,
      params: exercises.params,
    })
    .from(programExercises)
    .innerJoin(exercises, eq(programExercises.exerciseId, exercises.id))
    .where(eq(programExercises.programId, program.id));

  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }

  const days = Array.from(byDay.entries())
    .sort(([a], [b]) => dayRank(a) - dayRank(b))
    .map(([day, exs]) => ({
      day,
      exercises: exs.sort((a, b) => a.orderIndex - b.orderIndex),
    }));

  return NextResponse.json({
    programId: program.id,
    splitType: program.splitType,
    days,
  });
}
