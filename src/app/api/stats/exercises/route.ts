import { NextResponse } from "next/server";
import { loadStatRows, loadUnitSpecs, laneLabel, PORTABLE_LANE, type StatRow } from "@/lib/statsQuery";
import {
  groupLaneSessions,
  laneMode,
  sessionFigure,
  shapeLane,
  type Figure,
  type LaneMode,
} from "@/lib/statsShape";
import { markPrs } from "@/lib/prs";
import { laneTrend, type Trend } from "@/lib/trendVerdict";
import { loadAllSetLogInputs } from "@/lib/coreAdapters";

// GET /api/stats/exercises — the index + hub payload.
//
// ONLY exercises present in set_logs — never the /api/exercises/manage payload.
// Trend words come from the SHIPPED verdict engine via the thin adapter in
// src/lib/trendVerdict.ts (its vocabulary, its thresholds — no local word
// list). PR facts come from markPrs. Everything computed on read.

interface IndexEntry {
  exerciseId: string;
  name: string;
  sessionCount: number;
  machineLanes: number;
  lastTrained: string;
  laneMode: LaneMode;
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  /** Loaded lanes: lane best (BEST tag). Reps lanes: latest top-set reps
   *  (LAST tag) — no PR facts exist for reps lanes. */
  figure: { load?: number; reps?: number };
  /** The engine's verdict for the most-recently-used lane, verbatim. */
  trend: Trend;
  /** Date of the most recent PR-minting session across ALL lanes, or null. */
  prDate: string | null;
}

export async function GET() {
  const [rows, units] = await Promise.all([loadStatRows(), loadUnitSpecs()]);
  const unitLabels = new Map([...units.values()].map((u) => [u.id, u.label]));

  const byExercise = new Map<string, { name: string; rows: StatRow[] }>();
  for (const r of rows) {
    let e = byExercise.get(r.exerciseId);
    if (!e) byExercise.set(r.exerciseId, (e = { name: r.exerciseName, rows: [] }));
    e.rows.push(r);
  }

  // The engine's own input shape (effort→rir normalized), bulk-loaded through
  // the SAME adapter Train uses — the trend word must match what Train says.
  const engineSets = await loadAllSetLogInputs([...byExercise.keys()]);
  const engineByExercise = new Map<string, typeof engineSets>();
  for (const s of engineSets) {
    const list = engineByExercise.get(s.exerciseId) ?? [];
    list.push(s);
    engineByExercise.set(s.exerciseId, list);
  }

  // Hub hero material: sessions across ALL exercises + the global PR registry.
  const sessionSets = new Map<number, { date: string; workingSets: number }>();
  const globalPrSetIds = new Set<string | number>();
  const prEvents: Array<{ date: string; workoutLogId: number; name: string; load: number }> = [];

  const entries: IndexEntry[] = [];
  for (const [exerciseId, e] of byExercise) {
    const lanes = groupLaneSessions(e.rows);

    // Per-lane PR marking — markPrs over full lane history, the one source.
    const prDatesForExercise: string[] = [];
    for (const [, sessions] of lanes) {
      const mode = laneMode(sessions.flatMap((s) => s.sets));
      const { rows: shaped, prSetIds } = shapeLane(sessions, mode, markPrs);
      for (const id of prSetIds) globalPrSetIds.add(id);
      for (const sr of shaped) {
        if (sr.isPr) {
          prDatesForExercise.push(sr.date);
          const prSet = sessions
            .find((s) => s.workoutLogId === sr.workoutLogId)!
            .sets.filter((st) => prSetIds.has(st.id))
            .sort((a, b) => b.load - a.load)[0];
          if (prSet) prEvents.push({ date: sr.date, workoutLogId: sr.workoutLogId, name: e.name, load: prSet.load });
        }
      }
    }

    for (const r of e.rows) {
      const s = sessionSets.get(r.workoutLogId) ?? { date: r.date, workingSets: 0 };
      if (r.setType === "working") s.workingSets += 1;
      sessionSets.set(r.workoutLogId, s);
    }

    const machineLaneKeys = [...lanes.keys()].filter((l) => l !== PORTABLE_LANE && !l.endsWith(":unspecified"));
    const lastTrained = e.rows[e.rows.length - 1].date;

    // Most-recently-used lane = the one holding the newest session.
    let mruLane = "";
    let mruStamp = "";
    for (const [lane, sessions] of lanes) {
      const last = sessions[sessions.length - 1];
      const stamp = `${last.date}#${String(last.workoutLogId).padStart(9, "0")}`;
      if (stamp > mruStamp) {
        mruStamp = stamp;
        mruLane = lane;
      }
    }
    const mruSessions = lanes.get(mruLane)!;
    const mode = laneMode(mruSessions.flatMap((s) => s.sets));
    const figures = mruSessions
      .map((s) => ({ f: sessionFigure(s.sets), date: s.date }))
      .filter((x): x is { f: Figure; date: string } => x.f != null);

    let figure: IndexEntry["figure"];
    if (mode === "loaded") {
      figure = { load: Math.max(...figures.map((x) => x.f.load)) };
    } else {
      figure = { reps: figures[figures.length - 1].f.reps };
    }

    entries.push({
      exerciseId,
      name: e.name,
      sessionCount: new Set(e.rows.map((r) => r.workoutLogId)).size,
      machineLanes: machineLaneKeys.length,
      lastTrained,
      laneMode: mode,
      machineTag: laneLabel(mruLane, unitLabels),
      machineTagKind:
        mruLane === PORTABLE_LANE ? "none" : mruLane.endsWith(":unspecified") ? "unspecified" : "unit",
      figure,
      trend: laneTrend(engineByExercise.get(exerciseId) ?? [], mruLane === PORTABLE_LANE ? null : mruLane),
      prDate: prDatesForExercise.length ? prDatesForExercise.sort().at(-1)! : null,
    });
  }

  // Default order: recently trained. The client re-sorts for A–Z etc.
  entries.sort((a, b) =>
    a.lastTrained === b.lastTrained ? a.name.localeCompare(b.name) : b.lastTrained.localeCompare(a.lastTrained)
  );

  // Hub hero. Event line: the most recent weight PR anywhere; zero-state is
  // computed by the client from null, never a literal here.
  prEvents.sort((a, b) => (a.date === b.date ? a.workoutLogId - b.workoutLogId : a.date.localeCompare(b.date)));
  const lastPrEvent = prEvents.at(-1) ?? null;

  // Sparkline: working-set count per session, last 8 sessions, ascending.
  const allSessions = [...sessionSets.entries()]
    .map(([workoutLogId, v]) => ({ workoutLogId, ...v }))
    .sort((a, b) => (a.date === b.date ? a.workoutLogId - b.workoutLogId : a.date.localeCompare(b.date)));
  const spark = allSessions.slice(-8).map((s) => ({
    workoutLogId: s.workoutLogId,
    date: s.date,
    workingSets: s.workingSets,
  }));
  // Terminal point violet iff the LATEST session minted any PR.
  const latestSession = allSessions.at(-1) ?? null;
  const latestMintedPr =
    latestSession != null &&
    rows.some((r) => r.workoutLogId === latestSession.workoutLogId && globalPrSetIds.has(r.id));

  return NextResponse.json({
    meta: {
      exercisesTracked: entries.length,
      lastTrained: entries.length ? entries[0].lastTrained : null,
      lastPr: lastPrEvent ? { name: lastPrEvent.name, load: lastPrEvent.load, date: lastPrEvent.date } : null,
      spark,
      latestMintedPr,
    },
    exercises: entries,
  });
}
