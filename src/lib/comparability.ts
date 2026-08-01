// Machine-comparability inference — pure functions, no I/O.
//
// Lives in src/lib, NOT src/core, deliberately: core's standing invariant is
// equipment-blindness (it sees opaque lane keys and never learns what a pulley
// is), and this module is nothing BUT equipment knowledge. Same purity and
// test rigor as core; different side of the boundary.
//
// The model: suggestions are COMPUTED on demand and never stored; only the
// owner's DECISIONS persist (equipment_comparability, migration 0036). A
// suggestion is a question the structured specs can ask; the answer is
// knowledge only the owner has (same model? same cam?), and the confirmation
// is where that knowledge enters the system.
//
// Schema facts this maps onto (read from schema.ts, not assumed):
//   - There is no counterweight column. An assist is a NEGATIVE
//     built_in_weight — so "counterweight" below means builtInWeight ≠ 0/null.
//   - Pulley is `pulley_ratio_kind` TEXT ('1:1' | '2:1' | 'other' | 'unknown'),
//     not a number. Only N:1 forms parse to a ratio.
//   - The cammed-vs-plain distinction is the equipment_type itself:
//     'selectorized' (and leverage 'plate_loaded') are cammed — their resistance
//     curve is the cam's, so identical specs do NOT imply identical loads
//     across models. 'cable' is a plain station; with a known ratio and no
//     counterweight its load math is pure.

export interface ComparabilityUnit {
  id: string;
  label: string;
  equipmentType: string | null;
  pulleyRatioKind: string | null;
  builtInWeight: number | null;
  plateIncrement: number | null;
  addOnWeight: number | null;
  stackMax: number | null;
  stackUnit: string | null;
}

export type ComparabilityKind = "same_setup" | "ratio_estimate";

export interface Suggestion {
  kind: ComparabilityKind;
  /** Ordered a < b by unit id — the storage key shape. */
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  /** Honest, generated prose — snapshotted into the decision row on decide. */
  basis: string;
  /** ratio_estimate only: the parsed ratios, a's and b's. */
  ratios?: { a: number; b: number };
}

/** '2:1' → 2, '1:1' → 1; 'other' / 'unknown' / null → null (not a known ratio). */
export function parseRatio(kind: string | null): number | null {
  if (kind == null) return null;
  const m = /^(\d+):1$/.exec(kind);
  return m ? Number(m[1]) : null;
}

const CAMMED = new Set(["selectorized", "plate_loaded"]);

function num(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}
function zeroOrNull(v: number | null): boolean {
  const n = num(v);
  return n == null || n === 0;
}
function eqNullable(a: number | null, b: number | null): boolean {
  return (num(a) ?? null) === (num(b) ?? null);
}

/** Canonical pair order for storage and dedupe: lexicographic by unit id. */
export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Same setup: EVERY structured fact matches — type, pulley (both KNOWN, not
 * merely both unknown), stack unit, plate increment, add-on, stack max, and
 * built-in/counterweight (both null-or-zero, or exactly equal).
 *
 * For cammed types the basis says plainly that matching specs do not imply a
 * matching resistance curve — confirm only if same model. That caveat is the
 * suggestion being honest about what specs can and cannot know.
 */
export function suggestSameSetup(
  ua: ComparabilityUnit | null,
  ub: ComparabilityUnit | null
): Suggestion | null {
  if (!ua || !ub || ua.id === ub.id) return null; // NULL-unit lanes never party
  if (ua.equipmentType == null || ua.equipmentType !== ub.equipmentType) return null;
  const ra = parseRatio(ua.pulleyRatioKind);
  const rb = parseRatio(ub.pulleyRatioKind);
  if (ra == null || rb == null || ra !== rb) return null; // both known, equal
  if ((ua.stackUnit ?? null) !== (ub.stackUnit ?? null)) return null;
  if (!eqNullable(ua.plateIncrement, ub.plateIncrement)) return null;
  if (!eqNullable(ua.addOnWeight, ub.addOnWeight)) return null;
  if (!eqNullable(ua.stackMax, ub.stackMax)) return null;
  const cwOk =
    (zeroOrNull(ua.builtInWeight) && zeroOrNull(ub.builtInWeight)) ||
    eqNullable(ua.builtInWeight, ub.builtInWeight);
  if (!cwOk) return null;

  const [a, b] = pairKey(ua.id, ub.id);
  const [la, lb] = a === ua.id ? [ua.label, ub.label] : [ub.label, ua.label];
  const specs = [
    ua.equipmentType,
    `pulley ${ua.pulleyRatioKind}`,
    ua.plateIncrement != null ? `${ua.plateIncrement} plates` : null,
    ua.addOnWeight != null ? `+${ua.addOnWeight} add-on` : null,
    ua.stackMax != null ? `${ua.stackMax} stack` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const camCaveat = CAMMED.has(ua.equipmentType)
    ? " Specs match, but cams differ across models — the same number can be a different resistance. Combine only if these are the same machine model."
    : " Every recorded spec matches.";
  return {
    kind: "same_setup",
    a,
    b,
    aLabel: la,
    bLabel: lb,
    basis: `${la} and ${lb} record identical setups (${specs}).${camCaveat}`,
  };
}

/**
 * Ratio estimate: BOTH plain cable stations, both ratios known and different,
 * NEITHER counterweighted. Estimate = load / ratio (normalized 1:1-equivalent).
 * A counterweight on either side kills it — an additive term breaks pure
 * ratio math. Cammed units never receive this suggestion.
 */
export function suggestRatioEstimate(
  ua: ComparabilityUnit | null,
  ub: ComparabilityUnit | null
): Suggestion | null {
  if (!ua || !ub || ua.id === ub.id) return null;
  if (ua.equipmentType !== "cable" || ub.equipmentType !== "cable") return null;
  const ra = parseRatio(ua.pulleyRatioKind);
  const rb = parseRatio(ub.pulleyRatioKind);
  if (ra == null || rb == null || ra === rb) return null;
  if (!zeroOrNull(ua.builtInWeight) || !zeroOrNull(ub.builtInWeight)) return null;

  const [a, b] = pairKey(ua.id, ub.id);
  const ordered = a === ua.id ? [ua, ub] : [ub, ua];
  return {
    kind: "ratio_estimate",
    a,
    b,
    aLabel: ordered[0].label,
    bLabel: ordered[1].label,
    ratios: { a: parseRatio(ordered[0].pulleyRatioKind)!, b: parseRatio(ordered[1].pulleyRatioKind)! },
    basis:
      `${ordered[0].label} (${ordered[0].pulleyRatioKind}) and ${ordered[1].label} (${ordered[1].pulleyRatioKind}) are plain cable stations with different pulley ratios and no counterweight. ` +
      `Loads can be shown on one 1:1-equivalent axis by dividing each by its ratio (est = load ÷ ratio) — an estimate, never a stored value.`,
  };
}

/** Normalize a load to its 1:1-equivalent for the estimated series. */
export function ratioEstimate(load: number, ratio: number): number {
  return load / ratio;
}

export interface DecidedPair {
  a: string;
  b: string;
  kind: ComparabilityKind;
}

/**
 * All undecided suggestions among a set of units. A pair with ANY decision of
 * that kind — confirmed or rejected — is not re-suggested: confirmed pairs show
 * their state line instead, rejected pairs stay rejected.
 */
export function suggestFor(
  units: Array<ComparabilityUnit | null>,
  decided: DecidedPair[]
): Suggestion[] {
  const done = new Set(decided.map((d) => `${d.a}|${d.b}|${d.kind}`));
  const real = units.filter((u): u is ComparabilityUnit => u != null);
  const out: Suggestion[] = [];
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      for (const fn of [suggestSameSetup, suggestRatioEstimate]) {
        const s = fn(real[i], real[j]);
        if (s && !done.has(`${s.a}|${s.b}|${s.kind}`)) out.push(s);
      }
    }
  }
  return out;
}
