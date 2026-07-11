// The single place the effort tag becomes the numeric RIR the deterministic
// core consumes. Kept as a pure, dependency-free module so the mapping is unit-
// testable in isolation and the core never sees the UI label. See DECISIONS.md.

export type EffortTag = "more_in_me" | "near_failure" | "to_failure";

// to_failure = 0 (nothing left), near_failure = 1, more_in_me = 3 (reps left).
// With a typical target RIR ~2, "at target effort" (rir <= target) then counts
// near_failure/to_failure but NOT more_in_me — so a stall isn't flagged when you
// left reps in the tank.
export const EFFORT_TO_RIR: Record<EffortTag, number> = {
  to_failure: 0,
  near_failure: 1,
  more_in_me: 3,
};

/** Prefer an explicit exact RIR when present; otherwise derive from the tag. */
export function normalizedRir(effort: string | null, rir: string | number | null): number | null {
  if (rir !== null && rir !== undefined) return Number(rir);
  if (effort !== null && effort in EFFORT_TO_RIR) return EFFORT_TO_RIR[effort as EffortTag];
  return null;
}
