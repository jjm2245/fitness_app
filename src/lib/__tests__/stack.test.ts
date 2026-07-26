import { describe, it, expect } from "vitest";
import { suggestPlateIncrement, selectableLoads, formatSelectableLoads } from "../stack";

// The suggestion is a LOWER BOUND on the plate size, not a measurement — which
// is exactly why the form offers it rather than applying it.
describe("plate-increment suggestion (GCD of logged loads)", () => {
  it("finds the grid when the loads expose it", () => {
    expect(suggestPlateIncrement([140, 150, 160])).toBe(10);
    expect(suggestPlateIncrement([300, 320, 340])).toBe(20);
    expect(suggestPlateIncrement([110, 120, 130, 120])).toBe(10); // duplicates ignored
  });

  it("an add-on lever shows up as the finer step, not the plate", () => {
    // 10 lb plates with a 5 lb add-on select 10/15/20 — GCD is 5, the true
    // finest step. Correct as a lower bound; the user overrides to 10 if the
    // plate is what they meant.
    expect(suggestPlateIncrement([100, 105, 115])).toBe(5);
  });

  it("stays silent without enough signal", () => {
    expect(suggestPlateIncrement([])).toBeNull();
    expect(suggestPlateIncrement([100])).toBeNull();
    expect(suggestPlateIncrement([100, 110])).toBeNull(); // < 3 distinct
    expect(suggestPlateIncrement([100, 100, 100])).toBeNull(); // 1 distinct
  });

  it("refuses to guess a grid that isn't one", () => {
    expect(suggestPlateIncrement([100, 111, 130])).toBeNull(); // GCD 1
    expect(suggestPlateIncrement([264.55, 100, 150])).toBeNull(); // fractional
    expect(suggestPlateIncrement([0, -5, 100, 150, 200])).toBe(50); // junk filtered
  });
});

// The preview is what explains the three Stack fields — showing the grid beats
// describing it, and a wrong entry produces an obviously wrong line.
describe("selectable loads (the stack grid)", () => {
  it("a plain stack steps by the plate", () => {
    expect(selectableLoads(10, null, 50)).toEqual([10, 20, 30, 40, 50]);
  });

  it("an add-on lever fills in the gaps rather than shifting the grid", () => {
    // The lever is engaged or not — so each pin position gains a second option.
    expect(selectableLoads(10, 5, 40)).toEqual([10, 15, 20, 25, 30, 35, 40]);
  });

  it("never exceeds the stack ceiling", () => {
    expect(selectableLoads(10, 5, 22)).toEqual([10, 15, 20]);
    expect(selectableLoads(100, null, 240)).toEqual([100, 200]);
  });

  it("stays silent when it cannot compute a grid", () => {
    expect(selectableLoads(null, 5, 240)).toEqual([]); // no plate
    expect(selectableLoads(10, 5, null)).toEqual([]); // no max
    expect(selectableLoads(0, 5, 240)).toEqual([]); // nonsense plate
    expect(selectableLoads(10, 5, 5)).toEqual([]); // max below one plate
    expect(selectableLoads(0.1, null, 10_000)).toEqual([]); // absurd ratio, capped
  });

  it("formats head … max, and the owner's two spot-checks", () => {
    expect(formatSelectableLoads(selectableLoads(10, 5, 240), "lb")).toBe("10, 15, 20 … 240 lb");
    expect(formatSelectableLoads(selectableLoads(10, null, 240), "lb")).toBe("10, 20, 30 … 240 lb");
  });

  it("shows a short grid whole rather than eliding almost nothing", () => {
    expect(formatSelectableLoads(selectableLoads(10, null, 40), "lb")).toBe("10, 20, 30, 40 lb");
    expect(formatSelectableLoads([], "lb")).toBeNull();
  });

  it("renders through the caller's unit conversion", () => {
    // kg display of a 10/240 lb stack — storage is untouched, this is display.
    const kg = (lb: number) => String(Math.round((lb / 2.2046226218) * 10) / 10);
    expect(formatSelectableLoads(selectableLoads(10, null, 240), "kg", kg)).toBe("4.5, 9.1, 13.6 … 108.9 kg");
  });
});
