import { NextRequest, NextResponse } from "next/server";
import { loadStatRows, loadUnitSpecs, loadDecisions, laneLabel, PORTABLE_LANE, type DecisionRow } from "@/lib/statsQuery";
import { groupLaneSessions, laneMode, sessionFigure, shapeLane, type LaneMode } from "@/lib/statsShape";
import { markPrs } from "@/lib/prs";
import { suggestSameSetup, pairKey } from "@/lib/comparability";

// GET /api/stats/exercises/[id] — the exercise screen.
//
// Sessions grouped by workout_logs.id (never date). Rows and chart points come
// from ONE shaping pass (shapeLane), so chart PR dots byte-match the list
// chips by construction. Tonnage left the payload in v1.1 — nothing renders it.
//
// Comparability is PAIR-driven: every machine pair on this exercise ships its
// current situation (specs match / differ / unknown), the spec-suggested basis
// when the engine fires, the estimate direction (anchor = more sessions), and
// the pair's live decision if one exists. Estimates and merges stay Chart
// rendering — the List payload is byte-identical under any decision or factor.

interface SessionRowOut {
  workoutLogId: number;
  date: string;
  lane: string;
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  laneMode: LaneMode;
  figure: { load: number; reps: number } | null;
  repsList: number[] | null;
  setsCount: number;
  delta: ReturnType<typeof shapeLane>["rows"][number]["delta"];
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

  const sessionRows: SessionRowOut[] = [];
  const bests: Array<{ lane: string; machineTag: string; laneMode: LaneMode; load?: number; reps?: number; date: string }> = [];
  const chart: Array<{
    lane: string;
    machineTag: string;
    laneMode: LaneMode;
    points: Array<{ workoutLogId: number; date: string; value: number; reps: number; isPr: boolean }>;
  }> = [];
  const laneSessionCounts = new Map<string, number>();

  for (const [lane, sessions] of lanes) {
    const mode = laneMode(sessions.flatMap((s) => s.sets));
    const tag = laneLabel(lane, unitLabels);
    const tagKind: SessionRowOut["machineTagKind"] =
      lane === PORTABLE_LANE ? "none" : lane.endsWith(":unspecified") ? "unspecified" : "unit";
    laneSessionCounts.set(lane, sessions.length);

    const { rows: shaped, points } = shapeLane(sessions, mode, markPrs);
    for (const sr of shaped) {
      sessionRows.push({
        ...sr,
        lane,
        machineTag: tag,
        machineTagKind: tagKind,
        laneMode: mode,
        deltaHasUnit: tagKind === "unit",
      });
    }
    chart.push({ lane, machineTag: tag, laneMode: mode, points });

    if (mode === "loaded") {
      const best = shaped.reduce<{ load: number; date: string } | null>(
        (b, sr) => (sr.figure && (b == null || sr.figure.load > b.load) ? { load: sr.figure.load, date: sr.date } : b),
        null
      );
      if (best) bests.push({ lane, machineTag: tag, laneMode: mode, load: best.load, date: best.date });
    } else {
      const lastFig = [...sessions].reverse().find((s) => sessionFigure(s.sets));
      if (lastFig) bests.push({ lane, machineTag: tag, laneMode: mode, reps: sessionFigure(lastFig.sets)!.reps, date: lastFig.date });
    }
  }

  sessionRows.sort((a, b) => (a.date === b.date ? b.workoutLogId - a.workoutLogId : b.date.localeCompare(a.date)));

  // ── Comparability pairs — machine lanes only, NULL lanes never party ──
  const laneUnitIds = [...lanes.keys()].filter((l) => l !== PORTABLE_LANE && !l.endsWith(":unspecified"));
  const decisionFor = (a: string, b: string): DecisionRow | null => {
    const [ka, kb] = pairKey(a, b);
    return decisions.find((d) => d.a === ka && d.b === kb) ?? null;
  };

  const pairs: Array<{
    a: string;
    b: string;
    aLabel: string;
    bLabel: string;
    situation: "match" | "differ" | "unknown";
    specBasis: string | null;
    anchor: string;
    estimated: string;
    decision: DecisionRow | null;
  }> = [];
  for (let i = 0; i < laneUnitIds.length; i++) {
    for (let j = i + 1; j < laneUnitIds.length; j++) {
      const ua = units.get(laneUnitIds[i]) ?? null;
      const ub = units.get(laneUnitIds[j]) ?? null;
      if (!ua || !ub) continue;
      const suggestion = suggestSameSetup(ua, ub);
      // "Specs differ" only when both units actually STATE their facts; a
      // NULL-spec unit is unknown, not different — absence is not a value.
      const stated = (u: typeof ua) =>
        u.plateIncrement != null && u.stackMax != null && u.pulleyRatioKind != null && u.pulleyRatioKind !== "unknown";
      const situation: "match" | "differ" | "unknown" = suggestion ? "match" : stated(ua) && stated(ub) ? "differ" : "unknown";
      // Estimate direction: the machine with MORE sessions anchors; the other
      // is scaled. Tie → the lexicographically later id is estimated.
      const sa = laneSessionCounts.get(ua.id) ?? 0;
      const sb = laneSessionCounts.get(ub.id) ?? 0;
      const anchor = sa > sb ? ua.id : sb > sa ? ub.id : ua.id < ub.id ? ua.id : ub.id;
      const estimated = anchor === ua.id ? ub.id : ua.id;
      pairs.push({
        a: ua.id,
        b: ub.id,
        aLabel: ua.label,
        bLabel: ub.label,
        situation,
        specBasis: suggestion?.basis ?? null,
        anchor,
        estimated,
        decision: decisionFor(ua.id, ub.id),
      });
    }
  }

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
    comparability: { pairs },
  });
}
