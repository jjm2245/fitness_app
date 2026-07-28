// Entry-side input limits. PREVENTION, not commentary: a slipped digit should
// be impossible to type rather than something the app remarks on afterwards.
//
// The cap is on INTEGER DIGITS, never character count. `maxLength` would reject
// real values — 177.5 is six characters, 4.35 is four — so the limit has to
// understand the number's shape.
//
// A rejected keystroke leaves the previous value in place. The field therefore
// never displays something it won't keep, which is the difference between a
// limit and an autocorrect.

export interface NumericMaskOptions {
  /** Digits allowed BEFORE the decimal point. Decimals stay free below it. */
  maxIntDigits?: number;
  allowDecimal?: boolean;
  /** Assisted machines carry a negative built-in weight; those fields opt in. */
  allowNegative?: boolean;
}

/**
 * The value the field should show after this keystroke.
 *
 * Returns `prev` unchanged when the keystroke would break a rule — so typing
 * `12345` into a 4-digit field leaves `1234` on screen and the `5` simply does
 * not appear.
 */
export function maskNumeric(raw: string, prev: string, opts: NumericMaskOptions = {}): string {
  const { maxIntDigits = 4, allowDecimal = true, allowNegative = false } = opts;

  // Strip anything that isn't a digit, a decimal point, or a leading sign.
  let s = raw.replace(allowNegative ? /[^\d.-]/g : /[^\d.]/g, "");

  let sign = "";
  if (allowNegative) {
    // A minus is only meaningful in front. Typing it mid-number is a slip, not
    // an intention, so it's dropped rather than moved.
    if (s.startsWith("-")) sign = "-";
    s = s.replace(/-/g, "");
  }

  if (!allowDecimal) {
    s = s.replace(/\./g, "");
  } else {
    // Keep only the FIRST decimal point.
    const i = s.indexOf(".");
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
  }

  // Empty (or a lone sign / lone point) is a legal in-progress state — clearing
  // a field must always be possible.
  if (s === "" || s === ".") return sign + s;

  // A field sitting on a default must REPLACE on the next digit, not append:
  // typing 5 into a box showing 0 gives 5, never 05. This is the half that
  // survives a device where focus doesn't select — see NumberInput's onFocus.
  //
  // Only zeros followed by ANOTHER DIGIT go, which is what keeps the two
  // legitimate zeros intact: a deliberate `0` (added weight on a bodyweight
  // lift) has no digit after it, and `0.5` has a decimal point after it.
  s = s.replace(/^0+(?=\d)/, "");

  const intPart = s.split(".")[0];
  // Leading zeros are digits for display purposes but shouldn't burn the
  // allowance: "0.5" has one integer digit, not zero.
  if (intPart.replace(/^0+(?=\d)/, "").length > maxIntDigits) return prev;

  return sign + s;
}

/**
 * Per-field integer-digit caps.
 *
 * 4 is the floor and the default — 9999 is enterable, 12345 is not, which is
 * the shape a slipped digit actually takes. A field only gets a tighter cap
 * where its own semantics make one obvious; anything ambiguous keeps 4 rather
 * than guessing.
 */
export const INT_DIGITS = {
  /** 100+ rep bodyweight sets happen; 1000 does not. */
  reps: 3,
  /** Treadmill incline and machine levels are two-digit by construction. */
  incline: 2,
  level: 2,
  /** Covers mph and km/h with room for a decimal. */
  speed: 3,
  /** A lifetime of training is double digits. */
  trainingYears: 2,
  /** Centimetres. The ft/in pair is capped separately and much tighter. */
  heightCm: 3,
  heightFt: 1,
  heightIn: 2,
  /** Nobody programs 100 sets of anything. */
  targetSets: 2,
  /** Load, distance, duration, bodyweight and every stack field keep the
   *  default — none of them has an obvious tighter bound that couldn't bite a
   *  legitimate entry (a loaded leg press, a long ruck, a marathon). */
  default: 4,
} as const;
