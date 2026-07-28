"use client";

import { useEffect, useRef, useState } from "react";
import { formatForUnit, parseInUnit, type UnitDimension } from "@/lib/units";
import { maskNumeric, INT_DIGITS } from "@/lib/numericInput";
import { useDistanceUnit, useWeightUnit } from "@/lib/useUnit";

// THE weight/distance input (§3 universal pattern). The parent owns the
// CANONICAL value (lb/mi, string form, "" = empty); this component owns only
// the display text:
//   display = formatForUnit(canonical, unit)   (kg 1dp / km 2dp, cosmetic)
//   typing  → parseInUnit(text, unit) → onCanonical  (entry rounding applies)
//   unit toggle → re-FORMAT from canonical — never re-parse the display
// So toggling units any number of times without typing leaves the canonical
// value byte-identical, pre-filled or not. No lb-only islands.
export function UnitNumberInput({
  canonical,
  onCanonical,
  dimension,
  className,
  style,
  placeholder,
  autoFocus,
  unit: unitOverride,
  maxIntDigits = INT_DIGITS.default,
  allowNegative = false,
}: {
  canonical: string;
  onCanonical: (canonical: string) => void;
  dimension: UnitDimension;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  autoFocus?: boolean;
  // Pin this input to a specific unit instead of the global preference — for
  // values that state a FACT about a thing rather than a display choice (a
  // machine's stack is stamped in one unit no matter how you like to read
  // weights). The canonical-only contract below is unchanged: an override
  // re-FORMATS exactly like a preference change, and never re-parses.
  unit?: "lb" | "kg" | "mi" | "km";
  /** Integer-digit cap on the DISPLAYED value. Applied to what's typed, which
   *  is the unit the user is in — the canonical value follows from it. */
  maxIntDigits?: number;
  /** Assisted machines carry a negative built-in weight. */
  allowNegative?: boolean;
}) {
  const weight = useWeightUnit();
  const distance = useDistanceUnit();
  const preferred = dimension === "weight" ? weight[0] : distance[0];
  const unit = unitOverride ?? preferred;

  const [text, setText] = useState(() => formatForUnit(canonical, unit, dimension));
  // The canonical value our own typing last emitted — external canonical
  // changes resync the display; our own emissions must not (or "10." → "10").
  const lastEmitted = useRef(canonical);

  useEffect(() => {
    if (canonical !== lastEmitted.current) {
      lastEmitted.current = canonical;
      setText(formatForUnit(canonical, unit, dimension));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical]);

  // Unit change: re-format the display from canonical (never re-parse).
  useEffect(() => {
    setText(formatForUnit(lastEmitted.current, unit, dimension));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  function handleChange(raw: string) {
    // ONE mask for every numeric field in the app (src/lib/numericInput). A
    // keystroke that would exceed the integer-digit cap is refused, so the box
    // keeps the previous text rather than showing a value it will not keep.
    const masked = maskNumeric(raw, text, { maxIntDigits, allowDecimal: true, allowNegative });
    if (masked === text) return; // refused — nothing changed, don't re-emit
    setText(masked);
    const next = parseInUnit(masked, unit, dimension);
    lastEmitted.current = next;
    onCanonical(next);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      style={style}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={placeholder ?? unit}
      autoFocus={autoFocus}
    />
  );
}
