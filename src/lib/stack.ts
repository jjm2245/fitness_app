// Stack geometry helpers. Pure arithmetic, no domain policy — the equipment
// form is the only caller. Nothing here ever touches a stored load.

/** Greatest common divisor of two non-negative integers. */
function gcd2(a: number, b: number): number {
  while (b > 0) [a, b] = [b, a % b];
  return a;
}

/**
 * Suggest a plate increment from a unit's distinct logged loads.
 *
 * The GCD is a LOWER BOUND on the true plate size, not the answer: if you only
 * ever pinned 100 and 150, the GCD is 50 — correct as a divisor, wrong as a
 * plate. That's exactly why this is offered as a one-tap suggestion the user
 * accepts or overrides, never auto-applied.
 *
 * Returns null when there isn't enough signal (< 3 distinct loads), when the
 * loads aren't whole numbers (a fractional grid isn't a stack), or when the GCD
 * collapses to 1 (no meaningful common step).
 */
export function suggestPlateIncrement(loads: number[]): number | null {
  const distinct = [...new Set(loads.filter((n) => Number.isFinite(n) && n > 0))];
  if (distinct.length < 3) return null;
  if (distinct.some((n) => !Number.isInteger(n))) return null;
  const g = distinct.reduce((acc, n) => gcd2(acc, n), 0);
  return g > 1 ? g : null;
}
