import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, cardioLogs, workoutLogs, setLogs } from "@/db/schema";
import { routesToStrength } from "@/lib/logFields";
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
  // scope=exercise → the exercise's last session across ALL lanes/units, for
  // the exercise-level "last" reference line on the card (independent of the
  // selected unit). The default stays lane-scoped (progression + recalibration
  // rely on per-lane history). Additive, read-only; no schema/sync/core change.
  const scope = searchParams.get("scope");

  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));

  // Phase 2: the CONFIG routes (reps → strength; else metric), same rule as
  // the session card router — not conditioning_only.
  const metricRouted =
    exercise != null &&
    !routesToStrength({ name: exercise.name, conditioningOnly: exercise.conditioningOnly, logFields: exercise.logFields });

  if (metricRouted) {
    const [last] = await db
      .select({
        date: workoutLogs.date,
        durationMin: cardioLogs.durationMin,
        incline: cardioLogs.incline,
        speed: cardioLogs.speed,
        distance: cardioLogs.distance,
        level: cardioLogs.level,
        load: cardioLogs.load,
        effort: cardioLogs.effort,
      })
      .from(cardioLogs)
      .innerJoin(workoutLogs, eq(cardioLogs.workoutLogId, workoutLogs.id))
      .where(eq(cardioLogs.exerciseId, exerciseId))
      .orderBy(desc(workoutLogs.date))
      .limit(1);
    // Mixed-history honesty: a converted exercise may carry strength history
    // in set_logs. Surface a flag so the card can say "earlier strength
    // history exists" instead of a bare "no prior data". Past rows untouched.
    const [strengthRow] = await db
      .select({ id: setLogs.id })
      .from(setLogs)
      .where(eq(setLogs.exerciseId, exerciseId))
      .limit(1);
    return NextResponse.json({ cardio: last ?? null, hasStrengthHistory: strengthRow != null });
  }

  const allSets = await loadSetLogInputsForExercise(exerciseId);
  const laneSets = scope === "exercise" ? allSets : allSets.filter((s) => s.machineId === machineId);
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
