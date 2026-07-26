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

/**
 * The loads a stack can actually select, given its geometry.
 *
 * A plain stack selects multiples of the plate: 10, 20, 30…
 * An add-on lever adds its own value on TOP of any pin position, which is what
 * fills in the gaps: 10, 15, 20, 25… The lever is NOT weight that's always
 * applied — it's engaged or not — so it doubles the grid rather than shifting
 * it.
 *
 * Everything here is canonical lb, like every other stored weight; the caller
 * converts for display.
 */
export function selectableLoads(
  plate: number | null,
  addOn: number | null,
  max: number | null
): number[] {
  if (plate == null || max == null) return [];
  if (!Number.isFinite(plate) || !Number.isFinite(max)) return [];
  if (plate <= 0 || max < plate) return [];
  // A pathological plate/max ratio would generate an unbounded list; the grid
  // is a display aid, so cap it rather than build 10k entries.
  if (max / plate > 500) return [];
  const out = new Set<number>();
  for (let n = 1; n * plate <= max; n++) {
    out.add(n * plate);
    if (addOn != null && Number.isFinite(addOn) && addOn > 0 && n * plate + addOn <= max) {
      out.add(n * plate + addOn);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * "10, 15, 20 … 240 lb" — the first few selectable loads, an ellipsis, and the
 * ceiling. Showing the OUTPUT is what explains the three inputs, and a wrong
 * entry produces an obviously wrong grid, so it doubles as validation.
 *
 * `fmt` converts a canonical-lb value into the display unit, so the same
 * function serves the global preference and (once per-unit marking lands) a
 * machine's own marked unit.
 */
export function formatSelectableLoads(
  loads: number[],
  unitLabel: string,
  fmt: (lb: number) => string = (n) => String(n)
): string | null {
  if (loads.length === 0) return null;
  const head = loads.slice(0, 3).map(fmt);
  const last = loads[loads.length - 1];
  // Nothing elided — show the whole (short) grid rather than a misleading "…".
  if (loads.length <= 4) return `${loads.map(fmt).join(", ")} ${unitLabel}`;
  return `${head.join(", ")} … ${fmt(last)} ${unitLabel}`;
}
