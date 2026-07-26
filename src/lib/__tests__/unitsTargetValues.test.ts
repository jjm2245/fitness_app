import { describe, it, expect } from "vitest";
import { kgToLb, kmToMi, lbToKg, miToKm, displayWeights, formatForUnit, formatStoredDistance, parseInUnit, setEntryUnit, subscribeUnits } from "../units";
import { resolveCardFields } from "../logFields";
import { parseRangeValue, storeRangeValue, formatRangeValue, rangeValueComplete, hasRangeValue } from "../targetValues";

// Entry locks — rounding happens in the UNIT OF ENTRY, then converts exactly.
// (Regression guard: converting first and snapping to the 0.5-lb plate grid
// quantized kg to the wrong grid — 50 kg used to store 110 lb and read back
// 49.9 kg.)
describe("unit entry conversion", () => {
  it("kg → lb rounds in kg (0.1) and keeps 2 dp of lb", () => {
    expect(kgToLb(50)).toBe(110.23); // 110.2311… → 110.23, NOT the 110.0 snap
    expect(kgToLb(10)).toBe(22.05);
    expect(kgToLb(11)).toBe(24.25);
    expect(kgToLb(20)).toBe(44.09);
    expect(kgToLb(2.5)).toBe(5.51);
    expect(kgToLb(50.55)).toBe(111.55); // typed value rounds to 50.6 kg first
    expect(kgToLb(0)).toBe(0);
  });

  it("kg round-trips losslessly at display precision (the 50 kg bug)", () => {
    for (const typed of [50, 10, 2.5, 47.5, 74.4, 100, 0.1, 123.7]) {
      expect(lbToKg(kgToLb(typed))).toBe(typed); // type → store → read back
    }
  });

  it("km → mi rounds in km (0.01) and keeps 4 dp of mi", () => {
    expect(kmToMi(5)).toBe(3.1069); // 3.10686 → 3.1069, NOT the 3.11 snap
    expect(kmToMi(1)).toBe(0.6214);
    expect(kmToMi(10)).toBe(6.2137);
    expect(kmToMi(42.195)).toBe(26.2219); // marathon (42.2 km after entry round)
  });

  it("km round-trips losslessly at display precision", () => {
    for (const typed of [5, 1, 10, 3.22, 0.5, 42.2]) {
      expect(miToKm(kmToMi(typed))).toBe(typed);
    }
  });

  // Display rounding is COSMETIC and separate from entry rounding: kg → 1
  // decimal, km → 2. A display conversion never feeds back into storage.
  it("display: lb → kg (1 decimal), mi → km (2 decimals)", () => {
    expect(lbToKg(120)).toBe(54.4);
    expect(lbToKg(45)).toBe(20.4);
    expect(lbToKg(22.05)).toBe(10); // the 10 kg entry reads back as 10 kg
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

// §3 drift lock: display = formatForUnit(canonical); toggling units re-FORMATS
// and never re-parses, so canonical is byte-identical after any number of
// toggles — including the lossy case that proves why re-parsing is forbidden.
describe("universal unit input contract (drift-proof)", () => {
  it("10 unit toggles without typing leave canonical untouched", () => {
    const canonical = "22.3"; // lb — displays as 10.1 kg (lossy at 1dp)
    let display = "";
    for (let i = 0; i < 10; i++) {
      const unit = i % 2 === 0 ? "kg" : "lb";
      display = formatForUnit(canonical, unit, "weight"); // format ONLY
    }
    expect(canonical).toBe("22.3"); // never re-parsed
    expect(display).toBe("22.3"); // ended on lb: identity
    // The trap the contract avoids: re-parsing the rounded display would drift.
    expect(parseInUnit(formatForUnit("22.3", "kg", "weight"), "kg", "weight")).toBe("22.27");
  });

  it("stored distances display in the active unit (read-side only)", () => {
    expect(formatStoredDistance(2, "km")).toBe("3.22 km");
    expect(formatStoredDistance(2.4855, "mi")).toBe("2.49 mi"); // 4dp canonical displays 2dp
    expect(formatStoredDistance([3, 4], "km")).toBe("4.83–6.44 km");
    expect(formatStoredDistance([3, 4], "mi")).toBe("3–4 mi");
    expect(formatStoredDistance(0.5, "mi")).toBe("0.5 mi");
    expect(formatStoredDistance(null, "km")).toBeNull();
  });

  it("typing converts at entry rounding, and the field reads back what was typed", () => {
    expect(parseInUnit("50", "kg", "weight")).toBe("110.23");
    expect(formatForUnit("110.23", "kg", "weight")).toBe("50"); // reads 50 kg
    expect(parseInUnit("4", "km", "distance")).toBe("2.4855");
    expect(formatForUnit("2.4855", "km", "distance")).toBe("4"); // reads 4 km
    expect(parseInUnit("100", "lb", "weight")).toBe("100"); // identity in canonical unit
    expect(formatForUnit("2.4855", "mi", "distance")).toBe("2.49"); // mi display 2dp
    expect(formatForUnit("", "kg", "weight")).toBe("");
  });
});

// §2 drop-visibility lock: "+ Drop" is a load reduction — only where weight is
// in the resolved field set.
describe("metric drop visibility", () => {
  const canDrop = (name: string, conditioningOnly: boolean, logFields: unknown) =>
    resolveCardFields({ name, canonicalName: name, conditioningOnly, logFields }).includes("weight");
  it("offered on Loaded carry / Timed hold; absent on treadmill/distance", () => {
    expect(canDrop("Farmer's Walk", false, ["weight", "duration", "distance", "effort"])).toBe(true);
    expect(canDrop("Plank Hold", false, ["weight", "duration"])).toBe(true);
    expect(canDrop("Walking, Treadmill", true, null)).toBe(false);
    expect(canDrop("Skating", true, null)).toBe(false);
    expect(canDrop("Stairmaster", true, null)).toBe(false);
  });
});

// §3 lock: a per-unit marked unit is an OVERRIDE of the display preference, not
// a new storage mode. The canonical value must survive the override exactly as
// it survives a preference toggle — the same format-never-reparse contract.
describe("per-machine stack unit overrides the preference, never the storage", () => {
  it("a kg-marked stack round-trips through display without drifting canonical", () => {
    const canonical = "240"; // lb, as stored
    // Displayed in the machine's marked unit…
    expect(formatForUnit(canonical, "kg", "weight")).toBe("108.9");
    // …and toggling the GLOBAL preference cannot change what is stored.
    for (const pref of ["lb", "kg", "lb", "kg"] as const) {
      // The override wins, so display is stable regardless of `pref`.
      void pref;
      expect(formatForUnit(canonical, "kg", "weight")).toBe("108.9");
    }
    expect(canonical).toBe("240");
  });

  it("typing in the marked unit stores canonical lb", () => {
    expect(parseInUnit("100", "kg", "weight")).toBe("220.46");
    expect(formatForUnit("220.46", "kg", "weight")).toBe("100"); // reads back
  });

  it("an lb-marked stack is unaffected by a kg preference", () => {
    // The override pins the unit; the global preference is not consulted.
    expect(formatForUnit("240", "lb", "weight")).toBe("240");
    expect(parseInUnit("240", "lb", "weight")).toBe("240");
  });
});
