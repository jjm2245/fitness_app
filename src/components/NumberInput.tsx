"use client";

import { useEffect, useRef, useState } from "react";
import { maskNumeric, INT_DIGITS } from "@/lib/numericInput";
import { useSelectOnFocus } from "./selectOnFocus";

// THE plain numeric input — the unitless sibling of UnitNumberInput.
//
// Every raw `<input type="number">` in the app routed through here instead, so
// the digit cap is one component rather than twenty call sites. `type="text"`
// with `inputMode` is deliberate: a real `number` input can't be masked
// reliably (a browser reports "12e5" and partial values as an empty string,
// which silently defeats a keystroke-rejecting mask) and it draws spinners
// nobody taps on a phone.
export function NumberInput({
  value,
  onChange,
  maxIntDigits = INT_DIGITS.default,
  allowDecimal = true,
  allowNegative = false,
  className,
  style,
  placeholder,
  title,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  maxIntDigits?: number;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  title?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  // THIS COMPONENT OWNS THE DISPLAY TEXT, and that is load-bearing. Several
  // callers keep their state as a NUMBER, so a value round-tripped through the
  // parent loses any in-progress decimal: typing "177." emits "177.", the
  // parent stores Number("177.") = 177, and the dot vanishes as you type it —
  // "177.5" ends up as "1775". Holding the text here and only emitting upward
  // keeps the point alive until a digit follows it.
  const selectProps = useSelectOnFocus();
  const [text, setText] = useState(value);
  // What our own typing last emitted. An EXTERNAL change to `value` resyncs the
  // display; our own emissions must not (or the dot is stripped again).
  const lastEmitted = useRef(value);
  useEffect(() => {
    // Compare numerically where both parse, so "177." vs "177" isn't treated as
    // an external change — only a genuinely different value resyncs.
    const a = Number(value);
    const b = Number(lastEmitted.current);
    const same = value === lastEmitted.current || (Number.isFinite(a) && Number.isFinite(b) && a === b);
    if (!same) {
      lastEmitted.current = value;
      setText(value);
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      className={className}
      style={style}
      value={text}
      // Tapping in selects what's there, so the first keystroke REPLACES a
      // default instead of appending to it. The mask strips a leading zero as
      // well, deliberately — that half needs no focus event at all, so a device
      // that mishandles selection still can't produce an undeletable `05`.
      {...selectProps}
      // The mask decides what the field shows. A refused keystroke returns the
      // previous text, so the input never renders something it won't keep.
      onChange={(e) => {
        const masked = maskNumeric(e.target.value, text, { maxIntDigits, allowDecimal, allowNegative });
        if (masked === text) return; // refused — nothing to emit
        setText(masked);
        lastEmitted.current = masked;
        onChange(masked);
      }}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
    />
  );
}
