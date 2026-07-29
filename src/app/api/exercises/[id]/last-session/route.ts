import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, cardioLogs, workoutLogs, setLogs } from "@/db/schema";
import { laneKey } from "@/lib/equipment";
import { routesToStrength } from "@/lib/logFields";
import { loadSetLogInputsForExercise } from "@/lib/coreAdapters";
import { toSessionSummaries } from "@/core/machineTracking";
import { sessionsFromOldestToNewest } from "@/core/progression";

/**
 * Is this row a reduced-load continuation rather than a set of its own?
 *
 * A drop shares its parent's `set_index`, so the PARENT is the lowest id in the
 * group — established against the three real pairs in prod and pinned by a test.
 * One definition, used by the summary line and the PR filter alike.
 */
function isDropSegment(
  row: { id: number; dropGroup: string | null },
  all: Array<{ id: number; dropGroup: string | null }>
): boolean {
  if (row.dropGroup == null) return false;
  return all.some((o) => o.dropGroup === row.dropGroup && o.id < row.id);
}

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
  // The session whose own sets must not count toward the bar they are being
  // measured against.
  const excludeSession = searchParams.get("excludeSession");

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
      id: setLogs.id,
      load: setLogs.load,
      reps: setLogs.reps,
      equipmentId: setLogs.equipmentId,
      equipmentType: setLogs.equipmentType,
      dropGroup: setLogs.dropSetGroup,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(and(eq(setLogs.exerciseId, exerciseId), eq(workoutLogs.date, last.date), eq(setLogs.setType, "working")))
    // `set_index` is the EXPLICITLY RECORDED logged order — preferred over
    // `logged_at`, which on ids 7–29 is a value the 2026-07-27 backfill derived
    // from `created_at` rather than something observed. (`logged_at` is present
    // on all 245 rows; it is not a coverage question, it is a provenance one.)
    //
    // `id` is not just a formality: a DROP SEGMENT SHARES ITS PARENT'S
    // set_index, so it is the only thing separating them. Verified in prod —
    // all three drop pairs (55/56, 60/61, 109/110) have the parent at the lower
    // id and the heavier load, so parent-then-drop is the chronological order
    // this produces.
    .orderBy(asc(setLogs.setIndex), asc(setLogs.id));

  const laneRows =
    scope === "exercise"
      ? orderedRows
      : orderedRows.filter((r) => laneKey(r.equipmentType, r.equipmentId) === machineId);
  // PART B — a drop segment is the same set continued at a lighter load, not an
  // independent set, so it does not belong in a line whose load and reps make a
  // single claim together. `130 lb × 7, 3` said the 3 was a third set at 130
  // when it was a segment at 100.
  //
  // The parent is the LOWEST id in its group — the rule established and pinned
  // against the three real prod pairs (55/56, 60/61, 109/110), reused here
  // rather than re-derived. The parent still counts: it is a genuine working
  // set at the stated load.
  const laneOrdered = laneRows.filter((r) => !isDropSegment(r, laneRows));

  // ── The lane's best, for the header line and the PR chips ──
  //
  // Deliberately filtered in JS through `laneKey` rather than reconstructed in
  // SQL: the lane rule (unit id, else "type:unspecified", else portable) lives
  // in one place and a second SQL copy would be free to drift from it.
  const prRows = await db
    .select({
      id: setLogs.id,
      load: setLogs.load,
      date: workoutLogs.date,
      clientSessionId: workoutLogs.clientSessionId,
      equipmentId: setLogs.equipmentId,
      equipmentType: setLogs.equipmentType,
      dropGroup: setLogs.dropSetGroup,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(and(eq(setLogs.exerciseId, exerciseId), eq(setLogs.setType, "working")))
    .orderBy(asc(setLogs.id));

  const prLane = prRows
    .filter((r) => (scope === "exercise" ? true : laneKey(r.equipmentType, r.equipmentId) === machineId))
    // A drop segment carries a reduced load by definition — it can neither be a
    // record nor raise the bar. Same predicate as the summary line above.
    .filter((r, _i, all) => !isDropSegment(r, all));

  const bestRow = prLane.reduce<(typeof prLane)[number] | null>(
    (b, r) => (b == null || Number(r.load) > Number(b.load) ? r : b),
    null
  );
  // The bar a set logged in THIS session has to clear. Excluding the session
  // itself is what lets the card mark its own sets as it logs them without the
  // set it just wrote already counting as the record to beat.
  const priorRows = excludeSession ? prLane.filter((r) => r.clientSessionId !== excludeSession) : prLane;
  const priorBest = priorRows.length
    ? priorRows.reduce((m, r) => Math.max(m, Number(r.load)), Number.NEGATIVE_INFINITY)
    : null;

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
      //
      // DROP SEGMENTS ARE INCLUDED, unchanged from before: they are `working`
      // rows, so they were already in the old `sets` array and are already
      // counted in the line's rep list. The line flattens them, so a 3-rep drop
      // reads like a 3-rep set — the set ROWS distinguish them with `↳ drop`,
      // this one-line summary cannot. Left as-is deliberately; changing what
      // the line counts is a behaviour change, not an ordering fix.
      setsInOrder: laneOrdered.map((r) => ({ load: Number(r.load), reps: r.reps })),
      // Warm-ups are already excluded by the WHERE above, so this is the first
      // WORKING set — where you started, not where you finished or peaked.
      firstWorkingSet: laneOrdered[0]
        ? { load: Number(laneOrdered[0].load), reps: laneOrdered[0].reps }
        : null,
    },
    // WEIGHT ONLY and PER LANE. Computed, never stored — see src/lib/prs.ts.
    best: bestRow ? { load: Number(bestRow.load), date: bestRow.date } : null,
    priorBest,
  });
}
