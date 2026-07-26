// Unit-slip detection.
//
// The original slip: the global weight preference was on kg, the user typed the
// number off an lb stack, and 120 was stored as 264.55. Machine markings now
// make that impossible whenever a marked unit is selected — the input is pinned
// to the machine. What remains exposed is everything the global preference still
// governs: portable exercises, unmarked units, sets with no unit, and metric
// weight entry.
//
// THE SIGNAL, and why it is quiet: compare the RAW number typed against the
// lane's recent loads, and warn only when the raw number matches history while
// the CONVERTED number does not. That is the exact shape of a slip — you typed
// the number you always type, in the wrong unit. It says nothing about a real
// PR (raw far from history, converted near it), a first heavy session (no
// history at all), or ordinary progression.
//
// Deliberately NOT here: a general large-jump warning. That is where false
// positives live — a genuine PR trips it — and with the exposure this narrow it
// would be pure nagging.

export interface SlipCheck {
  /** The number as typed, in the entry unit. */
  typed: number;
  /** What it converts to in canonical units (lb/mi). */
  canonical: number;
  /** The unit the box is currently in. */
  entryUnit: string;
  /** The canonical unit for this dimension ("lb" or "mi"). */
  canonicalUnit: string;
  /** Recent loads for this exercise/lane, in CANONICAL units. */
  recentCanonical: number[];
}

export interface SlipWarning {
  typed: number;
  entryUnit: string;
  canonical: number;
  canonicalUnit: string;
  /** The lane's typical recent load, canonical. */
  typical: number;
}

/** How close the raw number must be to history to read as "the usual number". */
const RAW_MATCH = 0.15;
/** How far the converted number must be from history to read as wrong. */
const CONVERTED_FAR = 0.4;
/** Below this many prior loads there is nothing to compare against.
 *
 * ONE is correct here, and the reason is worth stating: the "last" reference is
 * a single working weight with several rep counts ("120 lb × 12, 11, 10"), so
 * requiring two distinct loads would silence the check on almost every real
 * exercise. One recent load is exactly the right reference — "your last Leg
 * Extensions was 120 lb" — and the two-sided test (raw matches it AND the
 * converted value does not) keeps a lone data point from over-firing. */
const MIN_HISTORY = 1;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Returns a warning only for the specific slip shape, else null.
 *
 * Callers MUST skip this entirely when a marked unit is selected: the input is
 * pinned there, a slip cannot occur, and a warning would be noise.
 */
export function detectUnitSlip(c: SlipCheck): SlipWarning | null {
  // Canonical entry cannot slip — the number typed is the number stored.
  if (c.entryUnit === c.canonicalUnit) return null;
  if (!Number.isFinite(c.typed) || c.typed <= 0) return null;
  const history = c.recentCanonical.filter((n) => Number.isFinite(n) && n > 0);
  if (history.length < MIN_HISTORY) return null; // nothing to compare against

  const typical = median(history);
  if (typical <= 0) return null;

  const rawMatchesHistory = Math.abs(c.typed - typical) <= RAW_MATCH * typical;
  const convertedIsFar = Math.abs(c.canonical - typical) >= CONVERTED_FAR * typical;
  if (!rawMatchesHistory || !convertedIsFar) return null;

  return { typed: c.typed, entryUnit: c.entryUnit, canonical: c.canonical, canonicalUnit: c.canonicalUnit, typical };
}

/**
 * Canonical loads out of the "last" reference line ("120 lb × 10, 10, 8").
 * That string is built in canonical lb — the same shape `displayWeights`
 * converts for display — so parsing it needs no extra fetch and cannot
 * disagree with what the card shows.
 */
export function recentLoadsFromLastText(lastText: string | null): number[] {
  if (!lastText) return [];
  const out: number[] = [];
  for (const m of lastText.matchAll(/(\d+(?:\.\d+)?) lb/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}
