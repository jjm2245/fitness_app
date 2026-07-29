import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, cardioLogs, workoutLogs, setLogs } from "@/db/schema";
import { laneKey } from "@/lib/equipment";
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
    !routesToStrength({ name: exercise.name, canonicalName: exercise.canonicalName, conditioningOnly: exercise.conditioningOnly, logFields: exercise.logFields });

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
      // Warm-ups are excluded from the reference line, mirroring the strength
      // path (core/machineTracking skips setType !== "working").
      .where(and(eq(cardioLogs.exerciseId, exerciseId), eq(cardioLogs.setType, "working")))
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

  // The FIRST working set of that session, asked for separately and ordered
  // explicitly.
  //
  // `session.sets` above CANNOT answer this: it comes from
  // loadSetLogInputsForExercise, whose query carries no ORDER BY, so its row
  // order is whatever Postgres happens to return — measured as load-DESCENDING
  // on real data (180, 175, 164 for a session logged 164, 175, 180). `sets[0]`
  // is therefore the heaviest set, not the first one.
  //
  // Deliberately additive rather than sorting the shared adapter: that adapter
  // feeds core, and core's `topSet` breaks ties by input order, so re-ordering
  // it would quietly change progression verdicts. The prefill needs an order;
  // core does not want a new one.
  const orderedRows = await db
    .select({
      load: setLogs.load,
      reps: setLogs.reps,
      equipmentId: setLogs.equipmentId,
      equipmentType: setLogs.equipmentType,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(and(eq(setLogs.exerciseId, exerciseId), eq(workoutLogs.date, last.date), eq(setLogs.setType, "working")))
    // set_index is the logged order; id breaks ties, since set_index has known
    // gaps and repeats in the owner's history (documented 2026-07-27).
    .orderBy(asc(setLogs.setIndex), asc(setLogs.id));

  const laneOrdered =
    scope === "exercise"
      ? orderedRows
      : orderedRows.filter((r) => laneKey(r.equipmentType, r.equipmentId) === machineId);

  return NextResponse.json({
    session: {
      date: last.date,
      // UNCHANGED and still unordered — progression and the recalibration note
      // read this, and core's `topSet` breaks ties by input order, so imposing
      // one here would quietly change verdicts. Display uses `setsInOrder`.
      sets: last.workingSets.map((s) => ({ load: s.load, reps: s.reps, rir: s.rir })),
      // The session AS LOGGED: ordered by set_index, warm-ups excluded. This is
      // what the card's "last …" line renders, so the line, the first-set load
      // and the prefilled values all describe the same set.
      setsInOrder: laneOrdered.map((r) => ({ load: Number(r.load), reps: r.reps })),
      // Warm-ups are already excluded by the WHERE above, so this is the first
      // WORKING set — where you started, not where you finished or peaked.
      firstWorkingSet: laneOrdered[0]
        ? { load: Number(laneOrdered[0].load), reps: laneOrdered[0].reps }
        : null,
    },
  });
}
