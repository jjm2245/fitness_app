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
    expect(resolveLogFields({ name: "Barbell Squat", canonicalName: "Barbell Squat", conditioningOnly: false, logFields: null }))
      .toEqual(["weight", "reps", "effort"]);
  });

  it("name-default maps the cardio guess onto the nearest profile (Phase 2)", () => {
    // stair guess (duration+level) → Cardio machine (gains blank-optional distance)
    expect(resolveLogFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: null }))
      .toEqual(expect.arrayContaining(["duration", "distance", "level"]));
    expect(resolveLogFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: null })).toHaveLength(3);
    // treadmill guess (duration+speed+incline) → Treadmill-style (gains distance)
    expect(new Set(resolveLogFields({ name: "Walking, Treadmill", canonicalName: "Walking, Treadmill", conditioningOnly: true, logFields: null })))
      .toEqual(new Set(["duration", "distance", "speed", "incline"]));
    // bike/row guess (duration+level+distance) → Cardio machine (same set)
    expect(new Set(resolveLogFields({ name: "Recumbent Bike", canonicalName: "Recumbent Bike", conditioningOnly: true, logFields: null })))
      .toEqual(new Set(["duration", "distance", "level"]));
    // fallback guess (duration+distance) → Distance cardio (unchanged)
    expect(new Set(resolveLogFields({ name: "Skating", canonicalName: "Skating", conditioningOnly: true, logFields: null })))
      .toEqual(new Set(["duration", "distance"]));
  });

  it("every default is a named profile (defaults and profiles speak the same sets)", () => {
    for (const name of ["Barbell Squat", "Stairmaster", "Walking, Treadmill", "Recumbent Bike", "Skating"]) {
      for (const conditioningOnly of [false, true]) {
        expect(matchProfile(defaultLogFields({ name, canonicalName: name, conditioningOnly }))).not.toBeNull();
      }
    }
  });

  it("override wins over the name-default, for either type", () => {
    expect(resolveLogFields({ name: "Power Stairs", canonicalName: "Power Stairs", conditioningOnly: true, logFields: ["duration", "distance"] }))
      .toEqual(["duration", "distance"]);
    expect(resolveLogFields({ name: "Barbell Squat", canonicalName: "Barbell Squat", conditioningOnly: false, logFields: ["weight", "duration"] }))
      .toEqual(["weight", "duration"]);
  });

  it("invalid/empty overrides fall through to defaults (never crash, never empty)", () => {
    const stairDefault = defaultLogFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true });
    expect(resolveLogFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: [] })).toEqual(stairDefault);
    expect(resolveLogFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: ["bogus", 3] })).toEqual(stairDefault);
    expect(resolveLogFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: "duration" })).toEqual(stairDefault);
  });

  it("sanitizeOverride dedupes, drops unknowns, and canonicalizes order", () => {
    expect(sanitizeOverride(["incline", "duration", "duration", "nope"])).toEqual(["duration", "incline"]);
    expect(sanitizeOverride([])).toBeNull();
    expect(sanitizeOverride(null)).toBeNull();
    expect(sanitizeOverride(["junk"])).toBeNull();
  });

  it("resolveMetricFields returns only the metric subset, in render order", () => {
    expect(resolveMetricFields({ name: "X", canonicalName: "X", conditioningOnly: false, logFields: ["weight", "reps", "incline", "duration"] }))
      .toEqual(["duration", "incline"]);
    expect(resolveMetricFields({ name: "Barbell Squat", canonicalName: "Barbell Squat", conditioningOnly: false, logFields: null }))
      .toEqual([]); // pure strength default has no metric fields
  });

  it("defaultLogFields ignores the override (feeds the '(default)' highlight)", () => {
    expect(new Set(defaultLogFields({ name: "Power Stairs", canonicalName: "Power Stairs", conditioningOnly: true })))
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
    expect(routesToStrength({ name: "Barbell Squat", canonicalName: "Barbell Squat", conditioningOnly: false, logFields: null })).toBe(true);
    expect(routesToStrength({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: null })).toBe(false);
    expect(routesToStrength({ name: "Walking, Treadmill", canonicalName: "Walking, Treadmill", conditioningOnly: true, logFields: null })).toBe(false);
    expect(routesToStrength({ name: "Skating", canonicalName: "Skating", conditioningOnly: true, logFields: null })).toBe(false);
  });

  it("the config decides, not the type: reps removed → metric; reps present → strength", () => {
    expect(routesToStrength({ name: "Farmer's Walk", canonicalName: "Farmer's Walk", conditioningOnly: false, logFields: ["weight", "duration", "distance", "effort"] })).toBe(false);
    expect(routesToStrength({ name: "Air Bike", canonicalName: "Air Bike", conditioningOnly: true, logFields: ["weight", "reps", "effort"] })).toBe(true);
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
    expect(resolveCardFields({ name: "Farmer's Walk", canonicalName: "Farmer's Walk", conditioningOnly: false, logFields: ["weight", "duration", "distance", "effort"] }))
      .toEqual(["weight", "duration", "distance", "effort"]);
    expect(resolveCardFields({ name: "Stairmaster", canonicalName: "Stairmaster", conditioningOnly: true, logFields: null }))
      .toEqual(["duration", "level", "distance"]);
  });
});

// ── Curated default remaps (audit 2026-07-24) ──
// These change what a NULL log_fields RESOLVES to — no row is ever written.
describe("curated default remaps", () => {
  // Library rows: canonical == display unless renamed (matches prod, where all
  // 15 remapped rows have canonical_name identical to their display name).
  const prof = (name: string, conditioningOnly = false) =>
    matchProfile(defaultLogFields({ name, canonicalName: name, conditioningOnly }))?.id ?? null;
  // A from-scratch custom has NO canonical name.
  const customProf = (name: string, conditioningOnly = false) =>
    matchProfile(defaultLogFields({ name, canonicalName: null, conditioningOnly }))?.id ?? null;
  // A RENAMED library row: display name differs, canonical is the library name.
  const renamedProf = (display: string, canonical: string, conditioningOnly = false) =>
    matchProfile(defaultLogFields({ name: display, canonicalName: canonical, conditioningOnly }))?.id ?? null;

  it("carries default to Loaded carry", () => {
    for (const n of [
      "Farmer's Walk", "Yoke Walk", "Rickshaw Carry", "Sled Push", "Sled Drag - Harness",
      "Bear Crawl Sled Drags", "Sled Overhead Backward Walk", "Backward Drag",
    ]) expect(prof(n)).toBe("loaded_carry");
    // cardio-typed, and previously mis-guessed as a rower via "p-ROW-ler"
    expect(prof("Prowler Sprint", true)).toBe("loaded_carry");
  });

  it("holds default to Timed hold", () => {
    for (const n of ["Plank", "Side Bridge", "One Handed Hang"]) expect(prof(n)).toBe("timed_hold");
  });

  it("cardio corrections", () => {
    expect(prof("Elliptical Trainer", true)).toBe("cardio_machine");
    expect(prof("Bicycling", true)).toBe("distance_cardio");
    expect(prof("Trail Running/Walking", true)).toBe("distance_cardio");
    // untouched cardio keeps its guess
    expect(prof("Bicycling, Stationary", true)).toBe("cardio_machine");
    expect(prof("Walking, Treadmill", true)).toBe("treadmill");
    expect(prof("Skating", true)).toBe("distance_cardio");
  });

  it("remapped carries/holds ROUTE to the metric card (no reps)", () => {
    for (const n of ["Farmer's Walk", "Plank", "Prowler Sprint"]) {
      // library rows: canonical == display
      expect(routesToStrength({ name: n, canonicalName: n, conditioningOnly: false, logFields: null })).toBe(false);
    }
  });

  it("struck + ambiguous names are UNCHANGED (still Strength)", () => {
    for (const n of [
      // ambiguous, deliberately left alone
      "Isometric Chest Squeezes", "Isometric Neck Exercise - Front And Back",
      "Isometric Neck Exercise - Sides", "Superman", "Monster Walk", "Spider Crawl",
      "Forward Drag with Press",
      // explicit false positives the audit rejected
      "Isometric Wipers", "Push Up to Side Plank", "Sled Row", "Sled Reverse Flye",
      "Sled Overhead Triceps Extension", "Sledgehammer Swings", "Drag Curl",
      "Hang Clean", "Hanging Leg Raise", "Hanging Pike", "Barbell Walking Lunge",
    ]) expect(prof(n)).toBe("strength");
    // Rope Jumping stays on its guessed default (no profile fits it)
    expect(prof("Rope Jumping", true)).toBe("distance_cardio");
  });

  it("matching is EXACT-normalized, never substring", () => {
    expect(prof("Plank")).toBe("timed_hold");
    expect(prof("  PLANK  ")).toBe("timed_hold");   // trim + case
    expect(prof("Farmer’s Walk")).toBe("loaded_carry"); // curly apostrophe
    // a longer name CONTAINING a mapped key must NOT inherit it
    expect(prof("Plank Jacks")).toBe("strength");
    expect(prof("Weighted Plank Row")).toBe("strength");
    expect(prof("Sled Push Press")).toBe("strength");
  });

  it("THE GATE: the cardio name-heuristic is unreachable for strength-typed rows", () => {
    // "row"/"step"/"bike" substrings must not affect a strength-typed exercise —
    // defaultLogFields returns Strength before cardioFields is ever consulted.
    for (const n of ["Bent Over Barbell Row", "Step-ups", "Seated Cable Row", "Bike Kicks"]) {
      expect(prof(n, false)).toBe("strength");
    }
    // the same names, cardio-typed, DO go through the heuristic
    expect(prof("Bent Over Barbell Row", true)).toBe("cardio_machine");
  });

  it("an explicit override still beats a curated remap", () => {
    expect(resolveLogFields({ name: "Plank", canonicalName: "Plank", conditioningOnly: false, logFields: ["weight", "reps", "effort"] }))
      .toEqual(["weight", "reps", "effort"]);
  });
});

// A rename must never change how an exercise logs. Defaults key on the
// CANONICAL (library) name; customs fall back to their display name.
describe("defaults survive a rename (canonical-name keying)", () => {
  const d = (name: string, canonicalName: string | null, conditioningOnly = false) =>
    matchProfile(defaultLogFields({ name, canonicalName, conditioningOnly }))?.id ?? null;

  it("renaming a curated-remap exercise keeps its profile", () => {
    expect(d("Farmer Carry", "Farmer's Walk")).toBe("loaded_carry");
    expect(d("Front Hold", "Plank")).toBe("timed_hold");
    expect(d("The Sled Thing", "Sled Push")).toBe("loaded_carry");
    expect(d("Ellipticals", "Elliptical Trainer", true)).toBe("cardio_machine");
  });

  it("renaming a cardio exercise keeps its name-guessed fields", () => {
    // the regression this guards: "Morning Walk" alone guesses duration+distance
    expect(d("Morning Walk", "Walking, Treadmill", true)).toBe("treadmill");
    expect(d("Morning Walk", null, true)).toBe("distance_cardio"); // no canonical → the guess
    expect(d("My Stairs", "Stairmaster", true)).toBe("cardio_machine");
  });

  it("a CUSTOM does not inherit a curated remap by name collision", () => {
    // renaming a from-scratch custom to "Plank" must NOT make it a Timed hold
    expect(d("Plank", null)).toBe("strength");
    expect(d("Farmer's Walk", null)).toBe("strength");
    expect(d("Sled Push", null)).toBe("strength");
  });

  it("an unrenamed library row (canonical == display) is unchanged", () => {
    expect(d("Plank", "Plank")).toBe("timed_hold");
    expect(d("Farmer's Walk", "Farmer's Walk")).toBe("loaded_carry");
    expect(d("Barbell Squat", "Barbell Squat")).toBe("strength");
  });

  it("the router follows the canonical default through a rename", () => {
    expect(routesToStrength({ name: "Farmer Carry", canonicalName: "Farmer's Walk", conditioningOnly: false, logFields: null })).toBe(false);
    expect(routesToStrength({ name: "Farmer Carry", canonicalName: null, conditioningOnly: false, logFields: null })).toBe(true);
  });
});
