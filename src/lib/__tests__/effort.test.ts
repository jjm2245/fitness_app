import { describe, it, expect } from "vitest";
import { EFFORT_TO_RIR, normalizedRir } from "../effort";

// The effort tag is a UI concept; the core only ever sees the number this
// produces. These lock the mapping so the "at target effort" semantics hold:
// with a typical target RIR ~2, near_failure/to_failure count as at-target and
// more_in_me does not.
describe("effort → normalized RIR", () => {
  it("maps tags so harder effort = lower RIR", () => {
    expect(EFFORT_TO_RIR.to_failure).toBe(0);
    expect(EFFORT_TO_RIR.near_failure).toBe(1);
    expect(EFFORT_TO_RIR.more_in_me).toBe(3);
    expect(EFFORT_TO_RIR.near_failure).toBeLessThan(EFFORT_TO_RIR.more_in_me);
  });

  it("near_failure/to_failure are at-or-below a target of 2; more_in_me is above", () => {
    const target = 2;
    expect(normalizedRir("to_failure", null)! <= target).toBe(true);
    expect(normalizedRir("near_failure", null)! <= target).toBe(true);
    expect(normalizedRir("more_in_me", null)! <= target).toBe(false);
  });

  it("prefers an explicit exact RIR over the tag", () => {
    expect(normalizedRir("to_failure", 4)).toBe(4);
    expect(normalizedRir("more_in_me", "1")).toBe(1);
  });

  it("returns null when neither effort nor rir is present", () => {
    expect(normalizedRir(null, null)).toBeNull();
    expect(normalizedRir("nonsense", null)).toBeNull();
  });
});
