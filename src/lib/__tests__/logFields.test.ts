import { describe, it, expect } from "vitest";
import {
  resolveLogFields,
  resolveMetricFields,
  resolveCardFields,
  sanitizeOverride,
  defaultLogFields,
  hasFieldOverride,
  routesToStrength,
  matchProfile,
  closestProfile,
  LOG_FIELD_PROFILES,
} from "../logFields";

// Locks the ONE precedence chain every surface resolves through:
// override (log_fields) → name-default (cardioFields → nearest profile) →
// type-default.
describe("logFields resolver", () => {
  it("type-default: strength → weight/reps/effort (the Strength profile)", () => {
    expect(resolveLogFields({ name: "Barbell Squat", conditioningOnly: false, logFields: null }))
      .toEqual(["weight", "reps", "effort"]);
  });

  it("name-default maps the cardio guess onto the nearest profile (Phase 2)", () => {
    // stair guess (duration+level) → Cardio machine (gains blank-optional distance)
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: null }))
      .toEqual(expect.arrayContaining(["duration", "distance", "level"]));
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: null })).toHaveLength(3);
    // treadmill guess (duration+speed+incline) → Treadmill-style (gains distance)
    expect(new Set(resolveLogFields({ name: "Walking, Treadmill", conditioningOnly: true, logFields: null })))
      .toEqual(new Set(["duration", "distance", "speed", "incline"]));
    // bike/row guess (duration+level+distance) → Cardio machine (same set)
    expect(new Set(resolveLogFields({ name: "Recumbent Bike", conditioningOnly: true, logFields: null })))
      .toEqual(new Set(["duration", "distance", "level"]));
    // fallback guess (duration+distance) → Distance cardio (unchanged)
    expect(new Set(resolveLogFields({ name: "Skating", conditioningOnly: true, logFields: null })))
      .toEqual(new Set(["duration", "distance"]));
  });

  it("every default is a named profile (defaults and profiles speak the same sets)", () => {
    for (const name of ["Barbell Squat", "Stairmaster", "Walking, Treadmill", "Recumbent Bike", "Skating"]) {
      for (const conditioningOnly of [false, true]) {
        expect(matchProfile(defaultLogFields({ name, conditioningOnly }))).not.toBeNull();
      }
    }
  });

  it("override wins over the name-default, for either type", () => {
    expect(resolveLogFields({ name: "Power Stairs", conditioningOnly: true, logFields: ["duration", "distance"] }))
      .toEqual(["duration", "distance"]);
    expect(resolveLogFields({ name: "Barbell Squat", conditioningOnly: false, logFields: ["weight", "duration"] }))
      .toEqual(["weight", "duration"]);
  });

  it("invalid/empty overrides fall through to defaults (never crash, never empty)", () => {
    const stairDefault = defaultLogFields({ name: "Stairmaster", conditioningOnly: true });
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: [] })).toEqual(stairDefault);
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: ["bogus", 3] })).toEqual(stairDefault);
    expect(resolveLogFields({ name: "Stairmaster", conditioningOnly: true, logFields: "duration" })).toEqual(stairDefault);
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

  it("defaultLogFields ignores the override (feeds the '(default)' highlight)", () => {
    expect(new Set(defaultLogFields({ name: "Power Stairs", conditioningOnly: true })))
      .toEqual(new Set(["duration", "distance", "level"]));
    expect(hasFieldOverride({ logFields: ["duration"] })).toBe(true);
    expect(hasFieldOverride({ logFields: null })).toBe(false);
  });
});

// THE router (Phase 2): reps → strength card + set_logs; else metric card +
// cardio_logs. conditioning_only is only the default seed.
describe("routesToStrength (the config router)", () => {
  it("fixed point: NULL-config rows route exactly as conditioning_only did", () => {
    // strength defaults contain reps → strength; every cardio default profile
    // contains no reps → metric. So for every untouched row old === new.
    expect(routesToStrength({ name: "Barbell Squat", conditioningOnly: false, logFields: null })).toBe(true);
    expect(routesToStrength({ name: "Stairmaster", conditioningOnly: true, logFields: null })).toBe(false);
    expect(routesToStrength({ name: "Walking, Treadmill", conditioningOnly: true, logFields: null })).toBe(false);
    expect(routesToStrength({ name: "Skating", conditioningOnly: true, logFields: null })).toBe(false);
  });

  it("the config decides, not the type: reps removed → metric; reps present → strength", () => {
    expect(routesToStrength({ name: "Farmer's Walk", conditioningOnly: false, logFields: ["weight", "duration", "distance", "effort"] })).toBe(false);
    expect(routesToStrength({ name: "Air Bike", conditioningOnly: true, logFields: ["weight", "reps", "effort"] })).toBe(true);
  });
});

describe("profiles", () => {
  it("each profile matches its own field set exactly", () => {
    for (const p of LOG_FIELD_PROFILES) {
      expect(matchProfile(p.fields)?.id).toBe(p.id);
      // and in any storage order
      expect(matchProfile([...p.fields].reverse())?.id).toBe(p.id);
    }
  });

  it("a non-matching set is custom, with an honest nearest profile", () => {
    const all8 = ["weight", "reps", "effort", "duration", "distance", "level", "speed", "incline"] as const;
    expect(matchProfile([...all8])).toBeNull();
    const { profile, diff } = closestProfile([...all8]);
    // nearest to all-8 is the largest profile (4 fields → ±4)
    expect(diff).toBe(4);
    expect(["treadmill", "loaded_carry"]).toContain(profile.id);
  });

  it("resolveCardFields orders cells weight → metrics → effort (Loaded carry mock)", () => {
    expect(resolveCardFields({ name: "Farmer's Walk", conditioningOnly: false, logFields: ["weight", "duration", "distance", "effort"] }))
      .toEqual(["weight", "duration", "distance", "effort"]);
    expect(resolveCardFields({ name: "Stairmaster", conditioningOnly: true, logFields: null }))
      .toEqual(["duration", "level", "distance"]);
  });
});
