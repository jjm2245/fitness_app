import { NextResponse } from "next/server";
import { loadStatRows, loadUnitSpecs, laneLabel, PORTABLE_LANE, type StatRow } from "@/lib/statsQuery";
import {
  arc,
  groupLaneSessions,
  laneMode,
  sessionFigure,
  figureSets,
  type Delta,
  type Figure,
  type LaneMode,
} from "@/lib/statsShape";
import { markPrs } from "@/lib/prs";

// GET /api/stats/exercises — the index + hub payload.
//
// ONLY exercises present in set_logs — never the /api/exercises/manage payload
// (878 rows, ~261 kB); this reads history and mentions ~28. Everything here is
// computed from set_logs on read; nothing is stored, so nothing can disagree
// with the rows it came from.

interface IndexEntry {
  exerciseId: string;
  name: string;
  sessionCount: number;
  machineLanes: number;
  lastTrained: string;
  laneMode: LaneMode;
  /** The most-recently-used lane's tag: unit label / "unspecified" / "no machine". */
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  /** Loaded lanes: the lane best (canonical lb) + its date. Reps lanes: the
   *  latest session's top-set reps, labeled `last` by the client — the word
   *  "best" never renders for a reps lane. */
  figure: { load?: number; reps?: number; date: string };
  /** Net change since the MRU lane began — the arc subline, delta grammar. */
  arc: Delta;
  arcHasUnit: boolean;
  /** True only when the LATEST session set the lane's best (weight PR). */
  latestIsBest: boolean;
}

export async function GET() {
  const [rows, units] = await Promise.all([loadStatRows(), loadUnitSpecs()]);
  const unitLabels = new Map([...units.values()].map((u) => [u.id, u.label]));

  // exercise → lane → sessions (ascending — rows arrive (date, id) ordered)
  const byExercise = new Map<string, { name: string; rows: StatRow[] }>();
  for (const r of rows) {
    let e = byExercise.get(r.exerciseId);
    if (!e) byExercise.set(r.exerciseId, (e = { name: r.exerciseName, rows: [] }));
    e.rows.push(r);
  }

  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  let prsThisMonth = 0;

  const entries: IndexEntry[] = [];
  for (const [exerciseId, e] of byExercise) {
    const lanes = groupLaneSessions(e.rows);

    // PRs are per-lane over the lane's FULL history in logged order — markPrs,
    // never a parallel strictly-greater in SQL. Count this month's for the hub.
    const prSetsByLane = new Map<string, Set<string | number>>();
    for (const [lane, sessions] of lanes) {
      const all = sessions.flatMap((s) =>
        s.sets.map((st) => ({
          key: st.id,
          load: st.load,
          setType: st.setType,
          isDropSegment: !figureSets(s.sets).some((f) => f.id === st.id) && st.setType === "working",
        }))
      );
      const prs = markPrs(all, null);
      prSetsByLane.set(lane, prs);
      for (const s of sessions) {
        if (s.date.startsWith(monthKey) && s.sets.some((st) => prs.has(st.id))) {
          prsThisMonth += s.sets.filter((st) => prs.has(st.id)).length;
        }
      }
    }

    const sessionIds = new Set(e.rows.map((r) => r.workoutLogId));
    const machineLaneKeys = [...lanes.keys()].filter(
      (l) => l !== PORTABLE_LANE && !l.endsWith(":unspecified")
    );
    const lastTrained = e.rows[e.rows.length - 1].date;

    // The most-recently-used lane — the one holding the newest session.
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
    const latest = figures[figures.length - 1];
    const first = figures[0];

    let figure: IndexEntry["figure"];
    let latestIsBest = false;
    if (mode === "loaded") {
      // Lane best = max figure-eligible load across the lane's history.
      let best = figures[0];
      for (const x of figures) if (x.f.load > best.f.load) best = x;
      figure = { load: best.f.load, date: best.date };
      const prs = prSetsByLane.get(mruLane)!;
      const lastSession = mruSessions[mruSessions.length - 1];
      latestIsBest = lastSession.sets.some((st) => prs.has(st.id) && st.load === best.f.load);
    } else {
      figure = { reps: latest.f.reps, date: latest.date };
    }

    entries.push({
      exerciseId,
      name: e.name,
      sessionCount: sessionIds.size,
      machineLanes: machineLaneKeys.length,
      lastTrained,
      laneMode: mode,
      machineTag: laneLabel(mruLane, unitLabels),
      machineTagKind:
        mruLane === PORTABLE_LANE ? "none" : mruLane.endsWith(":unspecified") ? "unspecified" : "unit",
      figure,
      arc: arc(first.f, latest.f, mode, figures.length),
      arcHasUnit: mruLane !== PORTABLE_LANE && !mruLane.endsWith(":unspecified"),
      latestIsBest,
    });
  }

  entries.sort((a, b) => (a.lastTrained === b.lastTrained ? a.name.localeCompare(b.name) : b.lastTrained.localeCompare(a.lastTrained)));

  const lastTrainedOverall = entries.length ? entries[0].lastTrained : null;
  return NextResponse.json({
    meta: {
      exercisesTracked: entries.length,
      prsThisMonth,
      monthLabel,
      lastTrained: lastTrainedOverall,
    },
    exercises: entries,
  });
}
