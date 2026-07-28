import { selectableLoads, suggestPlateIncrement } from "./stack";

// Turning the core's abstract "increase the load" into a number you can act on.
//
// The core computes a suggestion from reps and effort alone — it has no idea
// what this machine can select, and it must not: `src/core/*` stays free of
// equipment knowledge. So the snapping happens HERE, at the presentation
// boundary, on top of whatever core produced.
//
// The design is forced by the data. `plate_increment` and `stack_max` are NULL
// on every unit in the owner's gym, so a stored-values-only implementation
// would fall back to generic wording every single time — a feature that ships
// doing nothing. Hence the resolution chain below.

/** Where the increment came from — surfaced so the copy can be honest about
 *  whether the number is stated or inferred. */
export type IncrementSource = "stored" | "history" | null;

export interface GridSpec {
  /** `plate_increment` on the unit, if the user has recorded one. */
  storedIncrement: number | null;
  /** Distinct loads already logged on THIS lane — the GCD input. */
  loggedLoads: number[];
  /** A lever that adds on top of any pin position, filling in the gaps. */
  addOn: number | null;
  /** The heaviest the stack goes. */
  max: number | null;
}

/**
 * The increment, resolved through the chain: stored → derived from history →
 * unknown.
 *
 * The history step reuses `suggestPlateIncrement` — the SAME function behind
 * the equipment form's "Suggested from your logs", not a second implementation
 * that could drift from it. Its GCD is a LOWER BOUND on the true plate size,
 * which is the safe direction here: it can propose a step smaller than the
 * machine really offers, never one the machine can't reach.
 */
export function resolveIncrement(spec: GridSpec): { increment: number | null; source: IncrementSource } {
  if (spec.storedIncrement != null && Number.isFinite(spec.storedIncrement) && spec.storedIncrement > 0) {
    return { increment: spec.storedIncrement, source: "stored" };
  }
  const derived = suggestPlateIncrement(spec.loggedLoads);
  if (derived != null) return { increment: derived, source: "history" };
  return { increment: null, source: null };
}

export type NextLoad =
  | { kind: "load"; load: number; increment: number; source: IncrementSource }
  /** The stack has nothing above the current load. Saying so is the useful
   *  answer; suggesting an unreachable number is not. */
  | { kind: "at_max"; max: number }
  /** No increment could be resolved — the caller keeps the generic wording
   *  rather than inventing a number. */
  | { kind: "unknown" };

/**
 * The next load this machine can actually select above `current`.
 *
 * With an add-on lever the grid is not just multiples of the plate: a 10 lb
 * plate plus a 5 lb lever selects 10, 15, 20, 25… so the next load above 120
 * is 125, not 130. `selectableLoads` already models exactly that, so the grid
 * is enumerated rather than re-derived.
 *
 * Without a max there is no grid to enumerate (it would be unbounded), so the
 * answer is a plain step from the current load — which is the common case
 * today, every unit having a NULL stack_max.
 */
export function nextSelectableLoad(current: number, spec: GridSpec): NextLoad {
  const { increment, source } = resolveIncrement(spec);
  if (increment == null) return { kind: "unknown" };
  if (!Number.isFinite(current) || current < 0) return { kind: "unknown" };

  const grid = selectableLoads(increment, spec.addOn, spec.max);
  if (grid.length > 0) {
    const next = grid.find((v) => v > current);
    // Topped out: `current` is at or past everything the stack offers.
    if (next == null) return { kind: "at_max", max: grid[grid.length - 1] };
    return { kind: "load", load: next, increment, source };
  }

  // No enumerable grid (no max recorded). Step from where we are.
  const stepped = current + increment;
  if (spec.max != null && Number.isFinite(spec.max) && stepped > spec.max) {
    return { kind: "at_max", max: spec.max };
  }
  return { kind: "load", load: stepped, increment, source };
}

// ---------------------------------------------------------------------------
// Load sanity bounds (advisory only — never blocks a log)
// ---------------------------------------------------------------------------

/**
 * The absolute ceiling, in canonical lb.
 *
 * Chosen to sit above ANY entry a human could legitimately make and below the
 * shape of a slip. For reference: the heaviest raw squat ever recorded is
 * around 1100 lb, and a fully loaded leg press or hack squat tops out near
 * 1500 lb with every plate in the gym on it. 2000 lb clears all of that with
 * room to spare, while still catching the errors that actually happen — a
 * repeated digit (9999), a stray keypad row (12345), or a decimal slip that
 * multiplies by ten (1500 → 15000).
 *
 * Deliberately NOT derived from the user's own history. A "2× your usual"
 * bound was considered and rejected in the slip-guard round because a genuine
 * PR trips it, and a warning learned as noise is worse than no warning. The
 * kg/lb slip — the error that actually recurs — has its own specific check.
 */
export const ABSURD_LOAD_LB = 2000;

export type LoadWarning =
  | { kind: "above_stack"; stackMax: number }
  | { kind: "absurd" }
  | null;

/**
 * Should entering this load raise an eyebrow? Advisory only.
 *
 * `stack_max` is the precise check and fires only where a max is recorded —
 * NULL on every unit today, so this path is expected to stay quiet until the
 * owner fills some in. The absolute ceiling is the catch-all that works
 * everywhere, including for portable types with no unit at all.
 */
export function checkLoadSanity(canonicalLb: number, stackMax: number | null): LoadWarning {
  if (!Number.isFinite(canonicalLb) || canonicalLb <= 0) return null;
  if (canonicalLb >= ABSURD_LOAD_LB) return { kind: "absurd" };
  // Plates can be hung on some machines and the owner may simply be right, so
  // exceeding the stack is a question, not a verdict.
  if (stackMax != null && Number.isFinite(stackMax) && stackMax > 0 && canonicalLb > stackMax) {
    return { kind: "above_stack", stackMax };
  }
  return null;
}
