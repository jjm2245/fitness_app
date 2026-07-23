import { describe, it, expect } from "vitest";
import { resolveLogFields, resolveMetricFields, sanitizeOverride, defaultLogFields, hasFieldOverride } from "../logFields";

// Locks the ONE precedence chain every surface resolves through:
// override (log_fields) → name-default (cardioFields) → type-default.
describe("logFields resolver", () => {
  it("type-default: strength → weight/reps/effort", () => {
    expect(resolveLogFields({ name: "Barbell Squat", conditioningOnly: false, logFields: null }))
      .toEqual(["weight", "reps", "effort"]);
  });

  it("name-default: cardio resolves through cardioFields (Stairmaster → duration+level; Treadmill → duration+speed+incline)", () => {
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: null }))
      .toEqual(["duration", "level"]);
    expect(resolveLogFields({ name: "Walking, Treadmill", conditioningOnly: true, logFields: null }))
      .toEqual(["duration", "speed", "incline"]);
    // cardioFields' own fallback IS the cardio type-default (duration+distance)
    expect(resolveLogFields({ name: "Skating", conditioningOnly: true, logFields: null }))
      .toEqual(["duration", "distance"]);
  });

  it("override wins over the name-default, for either type", () => {
    expect(resolveLogFields({ name: "Power Stairs", conditioningOnly: true, logFields: ["duration", "distance"] }))
      .toEqual(["duration", "distance"]);
    expect(resolveLogFields({ name: "Barbell Squat", conditioningOnly: false, logFields: ["weight", "duration"] }))
      .toEqual(["weight", "duration"]);
  });

  it("invalid/empty overrides fall through to defaults (never crash, never empty)", () => {
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: [] }))
      .toEqual(["duration", "level"]);
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: ["bogus", 3] }))
      .toEqual(["duration", "level"]);
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: "duration" }))
      .toEqual(["duration", "level"]);
  });

  it("sanitizeOverride dedupes, drops unknowns, and canonicalizes order", () => {
    expect(sanitizeOverride(["incline", "duration", "duration", "nope"])).toEqual(["duration", "incline"]);
    expect(sanitizeOverride([])).toBeNull();
    expect(sanitizeOverride(null)).toBeNull();
    expect(sanitizeOverride(["junk"])).toBeNull();
  });

  it("resolveMetricFields returns only the metric subset, in render order", () => {
    expect(resolveMetricFields({ name: "X", conditioningOnly: false, logFields: ["weight", "reps", "incline", "duration"] }))
      .toEqual(["duration", "incline"]);
    expect(resolveMetricFields({ name: "Barbell Squat", conditioningOnly: false, logFields: null }))
      .toEqual([]); // pure strength default has no metric fields
  });

  it("defaultLogFields ignores the override (feeds the 'default for <type> is …' line)", () => {
    expect(defaultLogFields({ name: "Power Stairs", conditioningOnly: true })).toEqual(["duration", "level"]);
    expect(hasFieldOverride({ logFields: ["duration"] })).toBe(true);
    expect(hasFieldOverride({ logFields: null })).toBe(false);
  });
});
