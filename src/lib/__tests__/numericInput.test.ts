import { describe, it, expect } from "vitest";
import { maskNumeric, INT_DIGITS } from "../numericInput";

/** Type a string one character at a time, the way a field actually receives it. */
function type(chars: string, opts?: Parameters<typeof maskNumeric>[2], start = ""): string {
  let v = start;
  for (const ch of chars) v = maskNumeric(v + ch, v, opts);
  return v;
}

describe("integer-digit cap — the point of the whole change", () => {
  it("stops at 4 integer digits: 9999 enters, the 5th keystroke is refused", () => {
    expect(type("9999")).toBe("9999");
    expect(type("12345")).toBe("1234"); // the '5' never appears
  });

  it("does NOT limit character count — real values keep working", () => {
    // maxLength would have killed both of these.
    expect(type("177.5")).toBe("177.5");
    expect(type("4.35")).toBe("4.35");
    expect(type("9999.99")).toBe("9999.99");
  });

  it("decimals are free below the cap", () => {
    expect(type("1234.5678")).toBe("1234.5678");
  });

  it("leading zeros don't burn the allowance", () => {
    expect(type("0.5")).toBe("0.5");
    // Was "0000.5" before the replace-a-default fix. The property this test
    // exists for is unchanged — the value still enters, and the zeros still
    // don't count against the 4-digit cap — but redundant leading zeros now
    // collapse as they're typed instead of piling up.
    expect(type("0000.5")).toBe("0.5");
  });

  it("keeps only the first decimal point", () => {
    expect(type("1.2.3")).toBe("1.23");
  });

  it("always allows clearing the field", () => {
    expect(maskNumeric("", "1234")).toBe("");
    expect(maskNumeric(".", "")).toBe(".");
  });

  it("strips characters that aren't part of a number", () => {
    expect(maskNumeric("12a3", "12")).toBe("123");
  });
});

describe("negatives — assisted machines must stay enterable", () => {
  it("keeps a leading minus where the field allows it", () => {
    expect(type("-25", { allowNegative: true })).toBe("-25");
    expect(type("-9999", { allowNegative: true })).toBe("-9999");
    expect(type("-12345", { allowNegative: true })).toBe("-1234");
  });

  it("drops a minus typed mid-number — a slip, not an intention", () => {
    expect(maskNumeric("12-3", "12", { allowNegative: true })).toBe("123");
  });

  it("rejects a minus entirely where the field doesn't allow one", () => {
    expect(type("-25")).toBe("25");
  });
});

describe("integer-only fields", () => {
  it("refuses a decimal point when decimals are off", () => {
    expect(type("12.5", { allowDecimal: false })).toBe("125");
  });
});

describe("per-field caps behave as agreed", () => {
  it("reps: 3 digits in, 4 refused", () => {
    expect(type("100", { maxIntDigits: INT_DIGITS.reps })).toBe("100");
    expect(type("1000", { maxIntDigits: INT_DIGITS.reps })).toBe("100");
  });

  it("incline / level: 2 digits in, 3 refused", () => {
    expect(type("15", { maxIntDigits: INT_DIGITS.incline })).toBe("15");
    expect(type("150", { maxIntDigits: INT_DIGITS.incline })).toBe("15");
    // A decimal incline still works below the cap.
    expect(type("12.5", { maxIntDigits: INT_DIGITS.incline })).toBe("12.5");
  });

  it("speed: 3 digits, decimal intact", () => {
    expect(type("12.5", { maxIntDigits: INT_DIGITS.speed })).toBe("12.5");
    expect(type("1234", { maxIntDigits: INT_DIGITS.speed })).toBe("123");
  });

  it("training years: 2", () => {
    expect(type("25", { maxIntDigits: INT_DIGITS.trainingYears })).toBe("25");
    expect(type("250", { maxIntDigits: INT_DIGITS.trainingYears })).toBe("25");
  });

  it("height: 3 for cm, 1 for feet, 2 for inches", () => {
    expect(type("180", { maxIntDigits: INT_DIGITS.heightCm })).toBe("180");
    expect(type("1800", { maxIntDigits: INT_DIGITS.heightCm })).toBe("180");
    expect(type("6", { maxIntDigits: INT_DIGITS.heightFt })).toBe("6");
    expect(type("61", { maxIntDigits: INT_DIGITS.heightFt })).toBe("6");
    expect(type("11", { maxIntDigits: INT_DIGITS.heightIn })).toBe("11");
  });

  it("target sets: 2", () => {
    expect(type("12", { maxIntDigits: INT_DIGITS.targetSets })).toBe("12");
    expect(type("120", { maxIntDigits: INT_DIGITS.targetSets })).toBe("12");
  });

  it("the default keeps every legitimate heavy entry typeable", () => {
    // A loaded leg press, a long ruck, a marathon in metres — none of these
    // may become untypeable in the name of catching a slip.
    for (const v of ["1500", "999", "42.2", "5000"]) {
      expect(type(v)).toBe(v);
    }
  });
});

describe("a field holding a default must be REPLACED, not appended to", () => {
  const reps = { maxIntDigits: INT_DIGITS.reps, allowDecimal: false };

  it("typing 5 into a reps box showing 0 gives 5 — the daily-friction bug", () => {
    // The keystroke arrives as the concatenation the browser produced.
    expect(maskNumeric("05", "0", reps)).toBe("5");
  });

  it("keeps stripping however many zeros accumulated", () => {
    expect(maskNumeric("0164", "016", reps)).toBe("164");
    expect(maskNumeric("00", "0", reps)).toBe("0");
  });

  it("a DELIBERATE zero still enters — added weight on a bodyweight lift", () => {
    expect(maskNumeric("0", "", reps)).toBe("0");
    expect(maskNumeric("0", "")).toBe("0");
  });

  it("0.5 keeps its leading zero — the point is a digit-follows rule, not a strip-all", () => {
    expect(maskNumeric("0", "")).toBe("0");
    expect(maskNumeric("0.", "0")).toBe("0.");
    expect(maskNumeric("0.5", "0.")).toBe("0.5");
    // And typed in one go.
    expect(maskNumeric("0.5", "")).toBe("0.5");
    expect(maskNumeric("00.5", "0.5")).toBe("0.5");
  });

  it("does not eat a zero that is not leading", () => {
    expect(maskNumeric("10", "1", reps)).toBe("10");
    expect(maskNumeric("100", "10", reps)).toBe("100");
    expect(maskNumeric("205", "20", reps)).toBe("205");
  });

  it("survives a negative — the sign is split off before the strip", () => {
    expect(maskNumeric("-05", "-0", { allowNegative: true })).toBe("-5");
    expect(maskNumeric("-0", "-", { allowNegative: true })).toBe("-0");
  });

  it("digit caps still hold, and now count the stripped value", () => {
    expect(maskNumeric("0999", "099", reps)).toBe("999");   // 3 digits, allowed
    expect(maskNumeric("9999", "999", reps)).toBe("999");   // 4th digit refused
    expect(maskNumeric("12345", "1234")).toBe("1234");      // default cap of 4
    expect(maskNumeric("177.5", "177.")).toBe("177.5");     // the decimal case
  });

  it("character-by-character: 0 → 5 → 0 types 50, not 050", () => {
    // Typing with the caret at the END of a default 0, which is what a device
    // that ignores select() produces.
    let v = "0";
    v = maskNumeric(v + "5", v, reps);
    expect(v).toBe("5");
    v = maskNumeric(v + "0", v, reps);
    expect(v).toBe("50");
  });
});
