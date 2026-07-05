import { topSet, sessionsFromOldestToNewest, type SessionSummary } from "./progression";

// Spec §7 stall-buster: fires only on a true stall (caller is responsible for
// ruling out a machine change first — see machineTracking.ts), and works through
// a fixed ordered ladder of interventions rather than jumping straight to a deload.
// Framed as "keep overloading to keep growing," not "hit a PR."
export const STALL_INTERVENTION_LADDER = [
  { id: "micro_load_bump", message: "Try the smallest available load increase, even if reps drop a little." },
  { id: "add_rep_target", message: "Keep the load, but aim for one more rep than last time." },
  { id: "add_set", message: "Add one working set this session to increase total volume." },
  { id: "adjust_rest", message: "Extend rest between sets by 30-60s so you can push the working sets harder." },
  { id: "deload_and_recharge", message: "Deload: drop load ~10-20% for a session or two, then resume progression." },
] as const;

export type StallInterventionId = (typeof STALL_INTERVENTION_LADDER)[number]["id"];

/**
 * How many trailing sessions (most recent first) share the same top-set load and
 * reps at or below target RIR. A fresh true_stall (exactly at the detection
 * threshold) returns that threshold; a longer-persisting stall returns more,
 * without needing any persisted "which rung are we on" state.
 */
export function countTrailingFlatSessions(sessions: SessionSummary[], targetRir: number): number {
  const ordered = sessionsFromOldestToNewest(sessions).filter((s) => s.workingSets.length > 0);
  if (ordered.length === 0) return 0;

  const tops = ordered.map(topSet);
  let count = 1;
  for (let i = tops.length - 1; i > 0; i--) {
    const curr = tops[i];
    const prev = tops[i - 1];
    const bothAtTargetEffort =
      (curr.rir ?? targetRir) <= targetRir && (prev.rir ?? targetRir) <= targetRir;
    if (curr.load === prev.load && curr.reps === prev.reps && bothAtTargetEffort) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

export function nextStallIntervention(
  sessions: SessionSummary[],
  targetRir: number,
  stallSessionThreshold = 3
) {
  const flatSessions = countTrailingFlatSessions(sessions, targetRir);
  const rungsPastThreshold = Math.max(0, flatSessions - stallSessionThreshold);
  const rung = Math.min(rungsPastThreshold, STALL_INTERVENTION_LADDER.length - 1);
  return STALL_INTERVENTION_LADDER[rung];
}
