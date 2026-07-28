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

export interface IncrementDisagreement {
  /** What the unit's record says one plate weighs. */
  stored: number;
  /** The step every logged load on this unit actually uses. */
  logged: number;
}

/**
 * The unit's record and the unit's rows saying different things about the plate
 * size — the same shape as the built-in disagreement, and surfaced the same way.
 *
 * Stored still wins in `resolveIncrement`; this changes nothing about what gets
 * suggested. It only makes the disagreement VISIBLE, because a stored value
 * silently overrides the one piece of evidence capable of contradicting it.
 *
 * ONLY a coarser log pattern counts — `logged` must be a strict multiple of
 * `stored`, i.e. the logs never once used the finer step the unit claims. The
 * restriction is not fussiness, it is what keeps the add-on lever from firing
 * this constantly: with a 10 plate and a 5 lever the grid is 10, 15, 20, 25…,
 * so loads of 15/25/35 have a GCD of 5 against a stored 10 and are completely
 * correct. 5 is not a multiple of 10, so that case stays silent; VSL10's
 * 300/320/340 against a stored 10 gives 20, which is, so that one speaks.
 *
 * Deliberately NOT a claim that the stored value is wrong — a machine can have
 * a 10 lb plate you have simply never used an odd number of. Hence "check the
 * machine", not "fix this".
 */
export function findIncrementDisagreement(
  storedIncrement: number | null,
  loggedLoads: number[]
): IncrementDisagreement | null {
  if (storedIncrement == null || !Number.isFinite(storedIncrement) || storedIncrement <= 0) return null;
  // Reuses the SAME derivation as the suggestion button, so the two can never
  // disagree about what the logs imply.
  const derived = suggestPlateIncrement(loggedLoads);
  if (derived == null) return null; // < 3 distinct loads — too little history to claim anything
  if (derived === storedIncrement) return null; // they agree
  if (derived % storedIncrement !== 0) return null; // finer, or unrelated — see above
  return { stored: storedIncrement, logged: derived };
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

/** How a machine's stack is marked. NULL/absent = NOT RECORDED — the same
 * absence rule as `target_sets`, `log_fields` and `built_in_weight`: a missing
 * value is a missing statement, never a silent default. */
export type StackMarking = "lb" | "kg" | null;

export function parseStackMarking(v: unknown): StackMarking {
  return v === "lb" || v === "kg" ? v : null;
}

/**
 * Which unit a machine-scoped weight field should use.
 *
 * A RECORDED marking wins, because it states a fact about the machine (the
 * plates are stamped in one unit) rather than a preference about reading. When
 * nothing is recorded we fall back to the user's global preference — the
 * behaviour before markings existed.
 *
 * The distinction matters most for logging: pinning an input to "lb" because a
 * column defaulted to lb would assert something the user never said, and would
 * reproduce the kg-slip error in the opposite direction on a genuinely
 * kg-marked machine.
 */
export function resolveWeightUnit(marking: StackMarking, preference: "lb" | "kg"): "lb" | "kg" {
  return marking ?? preference;
}

/**
 * A weight rendered for a machine whose markings may differ from the reader's
 * display preference.
 *
 * The case this exists for: you prefer lb but travel to a gym whose machines
 * are marked kg. You need the kg to set the pin AND the lb to know how strong
 * you are — so the machine's unit leads and yours follows in parentheses.
 *
 * When they agree — every one of the owner's current units — this returns a
 * single value. The parenthetical must NEVER appear in the matching case, or
 * every normal row would carry redundant noise.
 *
 * `fmt` converts canonical lb into a display string for a given unit.
 */
export function formatDualWeight(
  canonicalLb: number,
  marking: StackMarking,
  preference: "lb" | "kg",
  fmt: (lb: number, unit: "lb" | "kg") => string
): string {
  const primary = resolveWeightUnit(marking, preference);
  const head = `${fmt(canonicalLb, primary)} ${primary}`;
  // Only a RECORDED marking that disagrees with the preference earns a second
  // value. An unrecorded machine is already being shown in the preference.
  if (marking == null || marking === preference) return head;
  return `${head} (${fmt(canonicalLb, preference)} ${preference})`;
}
