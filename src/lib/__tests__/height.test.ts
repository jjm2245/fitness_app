import { describe, it, expect } from "vitest";
import { inToCm, cmToIn, inToFtIn, ftInToIn, formatHeight } from "../units";

describe("height conversion", () => {
  it("round-trips inches → cm → inches within display precision", () => {
    for (const inches of [60, 65.5, 71, 74.25]) {
      expect(cmToIn(inToCm(inches))).toBeCloseTo(inches, 1);
    }
  });

  it("never produces 5 ft 12 — it rounds before splitting", () => {
    // The classic off-by-one: rounding the remainder AFTER the division gives
    // 5 ft 12 for 71.6 in. Rounding the total first cannot.
    expect(inToFtIn(71.6)).toEqual({ ft: 6, inch: 0 });
    expect(inToFtIn(71.4)).toEqual({ ft: 5, inch: 11 });
    expect(inToFtIn(72)).toEqual({ ft: 6, inch: 0 });
  });

  it("round-trips ft/in", () => {
    expect(ftInToIn(5, 11)).toBe(71);
    expect(inToFtIn(ftInToIn(6, 2))).toEqual({ ft: 6, inch: 2 });
  });

  it("formats in the unit the WEIGHT preference implies", () => {
    expect(formatHeight(71, "lb")).toBe("5′ 11″");
    expect(formatHeight(71, "kg")).toBe("180.3 cm");
  });

  it("absent height renders as absent, never 0", () => {
    expect(formatHeight(null, "lb")).toBeNull();
    expect(formatHeight(NaN, "lb")).toBeNull();
    // A recorded 0 is nonsense for height but is still not absence.
    expect(formatHeight(0, "lb")).toBe("0′ 0″");
  });
});
