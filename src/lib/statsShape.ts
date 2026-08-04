// Pure shaping for Stats v1 — no I/O. Routes fetch rows; everything here is
// deterministic and unit-tested.
//
// The rules this file owns (shared by every stats route):
//   Session  = workout_logs.id. Session order = (date, id). NEVER group by
//              date alone — two sessions on one calendar day are two sessions
//              (the last-session route's date-grouping is the known trap).
//   Set order within a session = (set_index, id).
//   Figure   = top WORKING set: max load, ties → more reps, then lowest id.
//              Warm-ups excluded. Drop segments never supply the figure and
//              never mint PRs, but they count toward set count and tonnage.
//   Lane mode: any working load > 0 → loaded lane; else reps lane.

export interface StatSet {
  id: number;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  dropGroup: string | null;
}

export interface LaneSession {
  workoutLogId: number;
  date: string; // YYYY-MM-DD
  sets: StatSet[]; // already in (set_index, id) order
}

/** The established rule, reused not re-derived: a drop segment shares its
 *  parent's drop_set_group, and the PARENT is the lowest id in the group. */
export function isDropSegment(set: StatSet, all: StatSet[]): boolean {
  if (set.dropGroup == null) return false;
  return all.some((o) => o.dropGroup === set.dropGroup && o.id < set.id);
}

/** Working sets that can carry a figure or a PR — segments and warm-ups out. */
export function figureSets(sets: StatSet[]): StatSet[] {
  return sets.filter((s) => s.setType === "working" && !isDropSegment(s, sets));
}

/** The null lane's grouping key. On screen it renders "no machine" — the
 *  permanent, correct absence for portable/bodyweight work. */
export const PORTABLE_LANE = "portable";

/** On-screen machine tag for a lane key. The word "lane" never renders:
 *  a named unit shows its label, the pooled context-bound lane shows
 *  "unspecified" (italic at the call site), the portable lane "no machine". */
export function laneLabel(lane: string, unitLabels: Map<string, string>): string {
  if (lane === PORTABLE_LANE) return "no machine";
  if (lane.endsWith(":unspecified")) return "unspecified";
  return unitLabels.get(lane) ?? lane;
}

export type LaneMode = "loaded" | "reps";

export function laneMode(allSets: StatSet[]): LaneMode {
  return allSets.some((s) => s.setType === "working" && s.load > 0) ? "loaded" : "reps";
}

export interface Figure {
  load: number;
  reps: number;
  setId: number;
  /** reps lanes compare TOTAL session reps, not the top set's. */
  totalReps: number;
}

/** The session's representative set for this lane, or null if no working sets. */
export function sessionFigure(sets: StatSet[]): Figure | null {
  const eligible = figureSets(sets);
  if (eligible.length === 0) return null;
  let best = eligible[0];
  for (const s of eligible.slice(1)) {
    if (
      s.load > best.load ||
      (s.load === best.load && s.reps > best.reps) ||
      (s.load === best.load && s.reps === best.reps && s.id < best.id)
    ) {
      best = s;
    }
  }
  const totalReps = sets
    .filter((s) => s.setType === "working")
    .reduce((n, s) => n + s.reps, 0);
  return { load: best.load, reps: best.reps, setId: best.id, totalReps };
}

/** Σ load×reps over working sets — drop segments IN, warm-ups OUT. */
export function tonnage(sets: StatSet[]): number {
  return sets.filter((s) => s.setType === "working").reduce((n, s) => n + s.load * s.reps, 0);
}

/** Sets the session performed on this lane — segments count, warm-ups don't. */
export function workingSetCount(sets: StatSet[]): number {
  return sets.filter((s) => s.setType === "working").length;
}

// ── Delta grammar — exhaustive, previous session of the SAME lane only ──────
//
// 1 +N lb                       bright
// 2 same load · N more reps     bright
// 3 held at N lb                quiet
// 4 same load · N fewer reps    quiet
// 5 −N lb                       quiet
// 6 first session on this machine   quiet
//
// Reps lanes use the same tiers with reps as the currency (total session
// reps): +N reps / held at N reps / −N reps / first. A machine switch never
// produces a cross-machine delta — the caller only ever passes the same lane's
// previous figure, so the first session after a switch arrives here as prev
// null → state 6.

export type DeltaState = 1 | 2 | 3 | 4 | 5 | 6;
export type DeltaTier = "bright" | "quiet";

export interface Delta {
  state: DeltaState;
  tier: DeltaTier;
  mode: LaneMode;
  /** Canonical-lb / rep quantities — the STRING is built display-side so the
   *  unit preference converts it (stored values untouched). */
  dLoad?: number;
  load?: number;
  dReps?: number;
}

export function delta(prev: Figure | null, curr: Figure, mode: LaneMode): Delta {
  if (prev == null) return { state: 6, tier: "quiet", mode };
  if (mode === "reps") {
    const d = curr.totalReps - prev.totalReps;
    if (d > 0) return { state: 1, tier: "bright", mode, dReps: d };
    if (d === 0) return { state: 3, tier: "quiet", mode, dReps: curr.totalReps };
    return { state: 5, tier: "quiet", mode, dReps: d };
  }
  const dLoad = curr.load - prev.load;
  if (dLoad > 0) return { state: 1, tier: "bright", mode, dLoad };
  if (dLoad < 0) return { state: 5, tier: "quiet", mode, dLoad };
  const dReps = curr.reps - prev.reps;
  if (dReps > 0) return { state: 2, tier: "bright", mode, dReps };
  if (dReps < 0) return { state: 4, tier: "quiet", mode, dReps };
  return { state: 3, tier: "quiet", mode, load: curr.load };
}

/**
 * The rendered string. `w` converts a canonical-lb number into the display
 * unit's numeral; `unit` is its label — so a kg preference renders `+4.5 kg`
 * from a stored +10 lb without touching storage.
 *
 * "first session on this machine" is exact for machine lanes; a lane with no
 * unit says "first session" — "this machine" would be false there.
 */
export function deltaText(
  d: Delta,
  w: (lb: number) => string | number = (n) => n,
  unit = "lb",
  hasUnit = true
): string {
  if (d.state === 6) return hasUnit ? "first session on this machine" : "first session";
  if (d.mode === "reps") {
    if (d.state === 1) return `+${d.dReps} reps`;
    if (d.state === 3) return `held at ${d.dReps} reps`;
    return `−${Math.abs(d.dReps ?? 0)} reps`;
  }
  switch (d.state) {
    case 1:
      return `+${w(d.dLoad!)} ${unit}`;
    case 2:
      return `same load · ${d.dReps} more reps`;
    case 3:
      return `held at ${w(d.load!)} ${unit}`;
    case 4:
      return `same load · ${Math.abs(d.dReps!)} fewer reps`;
    case 5:
      return `−${w(Math.abs(d.dLoad!))} ${unit}`;
  }
}

/** Net change since the lane began — the index's arc subline. Same grammar,
 *  computed first-session → latest-session. */
export function arc(first: Figure, latest: Figure, mode: LaneMode, sessions: number): Delta {
  if (sessions <= 1) return { state: 6, tier: "quiet", mode };
  return delta(first, latest, mode);
}

/**
 * Group flat set rows into lane → sessions. Rows must arrive ordered by
 * (date, workout_log_id, set_index, id). Sessions are KEYED BY workout_log_id
 * — two sessions on the same date stay two sessions.
 */
export function groupLaneSessions<
  R extends StatSet & { workoutLogId: number; date: string; lane: string }
>(rows: R[]): Map<string, LaneSession[]> {
  const lanes = new Map<string, LaneSession[]>();
  for (const r of rows) {
    let sessions = lanes.get(r.lane);
    if (!sessions) lanes.set(r.lane, (sessions = []));
    let sess = sessions[sessions.length - 1];
    if (!sess || sess.workoutLogId !== r.workoutLogId) {
      sessions.push((sess = { workoutLogId: r.workoutLogId, date: r.date, sets: [] }));
    }
    sess.sets.push({ id: r.id, setIndex: r.setIndex, setType: r.setType, load: r.load, reps: r.reps, dropGroup: r.dropGroup });
  }
  return lanes;
}
