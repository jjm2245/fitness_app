import { describe, it, expect } from "vitest";
import { kgToLb, kmToMi, lbToKg, miToKm, displayWeights, getEntryUnit, setEntryUnit, subscribeUnits } from "../units";
import { parseRangeValue, storeRangeValue, formatRangeValue, rangeValueComplete, hasRangeValue } from "../targetValues";

// §7 conversion locks — the shown converted value IS the stored value.
// Rounding rule: weight → nearest 0.5 lb; distance → 2 decimals (mi).
describe("unit entry conversion", () => {
  it("kg → lb rounds to the nearest 0.5 lb", () => {
    expect(kgToLb(10)).toBe(22); // 22.046 → 22.0
    expect(kgToLb(11)).toBe(24.5); // 24.251 → 24.5
    expect(kgToLb(20)).toBe(44); // 44.092 → 44.0
    expect(kgToLb(2.5)).toBe(5.5); // 5.512 → 5.5
    expect(kgToLb(0)).toBe(0);
  });

  it("km → mi rounds to 2 decimals", () => {
    expect(kmToMi(5)).toBe(3.11); // 3.10686 → 3.11
    expect(kmToMi(1)).toBe(0.62);
    expect(kmToMi(10)).toBe(6.21);
    expect(kmToMi(42.195)).toBe(26.22); // marathon
  });

  // Display rounding is COSMETIC and separate from entry rounding: kg → 1
  // decimal, km → 2. A display conversion never feeds back into storage.
  it("display: lb → kg (1 decimal), mi → km (2 decimals)", () => {
    expect(lbToKg(120)).toBe(54.4);
    expect(lbToKg(45)).toBe(20.4);
    expect(lbToKg(22)).toBe(10); // the 10 kg entry reads back as 10 kg
    expect(miToKm(2.49)).toBe(4.01);
    expect(miToKm(1)).toBe(1.61);
  });

  it("displayWeights transforms every 'N lb' in a reference line; identity in lb", () => {
    expect(displayWeights("120 lb × 10, 10, 8", "kg")).toBe("54.4 kg × 10, 10, 8");
    expect(displayWeights("you were at 90.5 lb on another unit", "kg")).toBe("you were at 41.1 kg on another unit");
    expect(displayWeights("120 lb × 10", "lb")).toBe("120 lb × 10");
    expect(displayWeights("no weights here", "kg")).toBe("no weights here");
  });

  // Global-preference coherence: ONE key per dimension; a set notifies every
  // subscriber, so all mounted surfaces follow a toggle together.
  it("global unit preference: one key, subscribers notified", () => {
    let notified = 0;
    const unsub = subscribeUnits(() => notified++);
    setEntryUnit("weight", "kg");
    expect(notified).toBe(1);
    // jsdom-less environment: getEntryUnit falls back to defaults without
    // window, so only the notification contract is asserted here.
    unsub();
    setEntryUnit("weight", "lb");
    expect(notified).toBe(1); // unsubscribed — no further calls
  });
});

// §5 distance-range locks — the shared single-or-range representation.
describe("target range values (duration + distance share this path)", () => {
  it("round-trips a stored range byte-identically (the [5,15] invariant)", () => {
    const parsed = parseRangeValue([5, 15]);
    expect(parsed).toEqual({ mode: "range", single: "", a: "5", b: "15" });
    expect(storeRangeValue(parsed)).toEqual([5, 15]); // no-edit save = identical
  });

  it("round-trips a stored single byte-identically", () => {
    const parsed = parseRangeValue(0.5);
    expect(parsed.mode).toBe("single");
    expect(storeRangeValue(parsed)).toBe(0.5);
    expect(storeRangeValue(parseRangeValue(30))).toBe(30);
  });

  it("stores a typed range as [min,max]; incomplete ranges store nothing", () => {
    expect(storeRangeValue({ mode: "range", single: "", a: "3", b: "4" })).toEqual([3, 4]);
    expect(storeRangeValue({ mode: "range", single: "", a: "3", b: "" })).toBeUndefined();
    expect(storeRangeValue({ mode: "single", single: "", a: "", b: "" })).toBeUndefined();
  });

  it("formats both shapes with the field's unit", () => {
    expect(formatRangeValue([3, 4], "mi")).toBe("3–4 mi");
    expect(formatRangeValue([5, 15], "min")).toBe("5–15 min");
    expect(formatRangeValue(0.5, "mi")).toBe("0.5 mi");
    expect(formatRangeValue(null, "mi")).toBeNull();
    expect(formatRangeValue("junk", "mi")).toBeNull();
  });

  it("completeness + presence checks match the anchor rules", () => {
    expect(rangeValueComplete({ mode: "range", single: "", a: "3", b: "4" })).toBe(true);
    expect(rangeValueComplete({ mode: "range", single: "", a: "3", b: "" })).toBe(false);
    expect(rangeValueComplete({ mode: "single", single: "0.5", a: "", b: "" })).toBe(true);
    expect(hasRangeValue([3, 4])).toBe(true);
    expect(hasRangeValue(2)).toBe(true);
    expect(hasRangeValue(undefined)).toBe(false);
  });
});
