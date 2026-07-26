import { describe, it, expect } from "vitest";
import { suggestPlateIncrement } from "../stack";

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
