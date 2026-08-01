import { NextRequest, NextResponse } from "next/server";
import { loadStatRows, loadUnitSpecs, loadDecisions, laneLabel, PORTABLE_LANE } from "@/lib/statsQuery";
import {
  delta,
  groupLaneSessions,
  isDropSegment,
  laneMode,
  sessionFigure,
  tonnage,
  workingSetCount,
  type Delta,
  type Figure,
  type LaneMode,
} from "@/lib/statsShape";
import { markPrs } from "@/lib/prs";
import { suggestFor } from "@/lib/comparability";

// GET /api/stats/exercises/[id] — the exercise screen.
//
// Sessions are grouped by workout_logs.id — NOT by date. The last-session
// route groups by date and would merge two sessions logged on one calendar
// day; Stats must never inherit that (regression fixture: two workout_logs
// rows, same date → two rows here).

interface SessionRow {
  workoutLogId: number;
  date: string;
  lane: string;
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  laneMode: LaneMode;
  figure: { load: number; reps: number } | null;
  /** Reps lanes list per-set reps instead of load × reps. */
  repsList: number[] | null;
  setsCount: number;
  tonnage: number;
  delta: Delta;
  deltaHasUnit: boolean;
  isPr: boolean;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [rows, units, decisions] = await Promise.all([loadStatRows(id), loadUnitSpecs(), loadDecisions()]);
  if (rows.length === 0) return NextResponse.json({ error: "no history for this exercise" }, { status: 404 });

  const unitLabels = new Map([...units.values()].map((u) => [u.id, u.label]));
  const lanes = groupLaneSessions(rows);
  const name = rows[0].exerciseName;

  const sessionRows: SessionRow[] = [];
  const bests: Array<{
    lane: string;
    machineTag: string;
    laneMode: LaneMode;
    load?: number;
    reps?: number;
    date: string;
  }> = [];
  const chart: Array<{
    lane: string;
    machineTag: string;
    laneMode: LaneMode;
    points: Array<{ workoutLogId: number; date: string; value: number; reps: number; isPr: boolean }>;
  }> = [];

  for (const [lane, sessions] of lanes) {
    const mode = laneMode(sessions.flatMap((s) => s.sets));
    const tag = laneLabel(lane, unitLabels);
    const tagKind: SessionRow["machineTagKind"] =
      lane === PORTABLE_LANE ? "none" : lane.endsWith(":unspecified") ? "unspecified" : "unit";
    const hasUnit = tagKind === "unit";

    // PRs over the lane's FULL history in logged order — markPrs, weight-only,
    // per-lane, exactly as shipped on the session card.
    const allSets = sessions.flatMap((s) =>
      s.sets.map((st) => ({
        key: st.id,
        load: st.load,
        setType: st.setType,
        isDropSegment: isDropSegment(st, s.sets),
      }))
    );
    const prs = markPrs(allSets, null);

    let prev: Figure | null = null;
    let bestFig: { load: number; date: string } | null = null;
    const points: (typeof chart)[number]["points"] = [];

    for (const s of sessions) {
      const fig = sessionFigure(s.sets);
      const d = delta(prev, fig ?? { load: 0, reps: 0, setId: -1, totalReps: 0 }, mode);
      const isPr = s.sets.some((st) => prs.has(st.id));
      sessionRows.push({
        workoutLogId: s.workoutLogId,
        date: s.date,
        lane,
        machineTag: tag,
        machineTagKind: tagKind,
        laneMode: mode,
        figure: fig ? { load: fig.load, reps: fig.reps } : null,
        repsList:
          mode === "reps"
            ? s.sets.filter((st) => st.setType === "working").map((st) => st.reps)
            : null,
        setsCount: workingSetCount(s.sets),
        tonnage: tonnage(s.sets),
        delta: d,
        deltaHasUnit: hasUnit,
        isPr,
      });
      if (fig) {
        if (mode === "loaded" && (bestFig == null || fig.load > bestFig.load)) {
          bestFig = { load: fig.load, date: s.date };
        }
        points.push({
          workoutLogId: s.workoutLogId,
          date: s.date,
          value: mode === "loaded" ? fig.load : fig.reps,
          reps: fig.reps,
          isPr: mode === "loaded" && isPr,
        });
        prev = fig;
      }
    }

    const lastWithFig = [...sessions].reverse().find((s) => sessionFigure(s.sets));
    if (mode === "loaded" && bestFig) {
      bests.push({ lane, machineTag: tag, laneMode: mode, load: bestFig.load, date: bestFig.date });
    } else if (lastWithFig) {
      const f = sessionFigure(lastWithFig.sets)!;
      // Reps lanes: labeled `last` by the client — never "best", never a PR.
      bests.push({ lane, machineTag: tag, laneMode: mode, reps: f.reps, date: lastWithFig.date });
    }

    chart.push({ lane, machineTag: tag, laneMode: mode, points });
  }

  // Newest first for the combined timeline: (date, workoutLogId) desc.
  sessionRows.sort((a, b) =>
    a.date === b.date ? b.workoutLogId - a.workoutLogId : b.date.localeCompare(a.date)
  );

  // Comparability: only this exercise's NAMED units are ever party.
  const laneUnitIds = [...lanes.keys()].filter((l) => l !== PORTABLE_LANE && !l.endsWith(":unspecified"));
  const exerciseUnits = laneUnitIds.map((uid) => units.get(uid) ?? null);
  const relevantDecisions = decisions.filter(
    (d) => laneUnitIds.includes(d.a) && laneUnitIds.includes(d.b)
  );
  const suggestions = suggestFor(
    exerciseUnits,
    relevantDecisions.map((d) => ({ a: d.a, b: d.b, kind: d.kind }))
  );

  const dates = rows.map((r) => r.date);
  return NextResponse.json({
    exerciseId: id,
    name,
    sessionCount: new Set(rows.map((r) => r.workoutLogId)).size,
    machineCount: laneUnitIds.length,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    bests,
    sessions: sessionRows,
    chart,
    comparability: { suggestions, decisions: relevantDecisions },
  });
}
