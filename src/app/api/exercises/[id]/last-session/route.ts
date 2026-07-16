import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, cardioLogs, workoutLogs } from "@/db/schema";
import { loadSetLogInputsForExercise } from "@/lib/coreAdapters";
import { toSessionSummaries } from "@/core/machineTracking";
import { sessionsFromOldestToNewest } from "@/core/progression";

// Previous-session reference for the logging screen. Strength lifts return the
// last session's set numbers ("50 × 10, 10, 9"); conditioning exercises return
// the last cardio entry's shape (duration/incline/…) instead, since they're
// logged and stored entirely separately from set_logs.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: exerciseId } = await params;
  const { searchParams } = new URL(request.url);
  const machineId = searchParams.get("lane") ?? searchParams.get("machineId");

  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));

  if (exercise?.conditioningOnly) {
    const [last] = await db
      .select({
        date: workoutLogs.date,
        durationMin: cardioLogs.durationMin,
        incline: cardioLogs.incline,
        speed: cardioLogs.speed,
        distance: cardioLogs.distance,
        level: cardioLogs.level,
      })
      .from(cardioLogs)
      .innerJoin(workoutLogs, eq(cardioLogs.workoutLogId, workoutLogs.id))
      .where(eq(cardioLogs.exerciseId, exerciseId))
      .orderBy(desc(workoutLogs.date))
      .limit(1);
    return NextResponse.json({ cardio: last ?? null });
  }

  const allSets = await loadSetLogInputsForExercise(exerciseId);
  const laneSets = allSets.filter((s) => s.machineId === machineId);
  const sessions = sessionsFromOldestToNewest(toSessionSummaries(laneSets));

  const last = sessions[sessions.length - 1];
  if (!last) {
    return NextResponse.json({ session: null });
  }

  return NextResponse.json({
    session: {
      date: last.date,
      sets: last.workingSets.map((s) => ({ load: s.load, reps: s.reps, rir: s.rir })),
    },
  });
}
