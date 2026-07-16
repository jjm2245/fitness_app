import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EQUIPMENT_TYPES, EQUIPMENT_TYPE_BY_ID, laneKey, suggestEquipmentType } from "../equipment";

describe("equipment registry (3b) — never invent precision", () => {
  it("standardized tools have real defaults; unit-specific ones are unknown or weak-flagged", () => {
    expect(EQUIPMENT_TYPE_BY_ID.get("olympic_barbell")!.defaultOffset).toBe(45);
    expect(EQUIPMENT_TYPE_BY_ID.get("dumbbell")!.defaultOffset).toBe(0);
    // plate-loaded is UNKNOWN (null), not 0 — prompt per unit, never guess.
    expect(EQUIPMENT_TYPE_BY_ID.get("plate_loaded")!.defaultOffset).toBeNull();
    // weak typicals are flagged so the UI confirms rather than silently applies.
    expect(EQUIPMENT_TYPE_BY_ID.get("smith")!.weakDefault).toBe(true);
    expect(EQUIPMENT_TYPE_BY_ID.get("ez_curl_bar")!.weakDefault).toBe(true);
  });

  it("instanceMatters is exactly the context-bound set", () => {
    const bound = EQUIPMENT_TYPES.filter((t) => t.instanceMatters).map((t) => t.id).sort();
    expect(bound).toEqual(["cable", "plate_loaded", "selectorized", "smith"]);
  });
});

describe("lane keys (3e) — opaque to the core, unspecified is NOT portable", () => {
  it("named unit keeps its raw id (no re-baseline blips from the migration)", () => {
    expect(laneKey("smith", "unit-abc")).toBe("unit-abc");
    expect(laneKey(null, "legacy-unit")).toBe("legacy-unit");
  });
  it("context-bound without a unit gets its own type lane", () => {
    expect(laneKey("smith", null)).toBe("smith:unspecified");
    expect(laneKey("plate_loaded", null)).toBe("plate_loaded:unspecified");
  });
  it("portable types are the null lane; legacy rows unchanged", () => {
    expect(laneKey("dumbbell", null)).toBeNull();
    expect(laneKey("olympic_barbell", null)).toBeNull();
    expect(laneKey(null, null)).toBeNull(); // legacy set → today's lane
  });
});

describe("pre-select (3f) — visible default, zero-offset-safe fallback", () => {
  it("maps load types directly and resolves free_weight by keyword", () => {
    expect(suggestEquipmentType("smith", "Smith Machine Squat")).toBe("smith");
    expect(suggestEquipmentType("machine_selectorized", "Leg Extension")).toBe("selectorized");
    expect(suggestEquipmentType("free_weight", "Dumbbell Shrug")).toBe("dumbbell");
    expect(suggestEquipmentType("free_weight", "Barbell Squat")).toBe("olympic_barbell");
    expect(suggestEquipmentType("free_weight", "EZ-Bar Skullcrusher")).toBe("ez_curl_bar");
    expect(suggestEquipmentType("free_weight", "Skullcrusher")).toBe("dumbbell"); // fallback = zero offset
  });
});

// Structural guards: the core must never learn what equipment is, and the pulley
// ratio must be provably absent from all load math. Codified as tests so a
// regression (or a future agent folding the ratio in) fails loudly.
describe("core generality + pulley-never-in-math (structural guards)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("src/core/* contains no equipment literals", () => {
    const coreDir = join(process.cwd(), "src/core");
    const offenders: string[] = [];
    for (const f of readdirSync(coreDir)) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const body = read(join("src/core", f));
      // Boundary, stated precisely: the core has ALWAYS consumed the seed's
      // load_type taxonomy (spec §6/§9 — e.g. progression's per-load-type
      // increment table predates the Equipment model), and the substitution
      // filter's equipmentRequired treats values as opaque strings. What the
      // core must NEVER contain is the NEW model's vocabulary: the type
      // registry, lane construction, offsets, ratios.
      // (The core defines its OWN generic laneKey(exerciseId, machineId) grouping
      // helper — that is the wanted generality, not a model reference.)
      if (/EquipmentType|pulley|dumbbell|kettlebell|olympic_barbell|ez_curl_bar|fixed_barbell|builtInWeight|built_in_weight|unspecified/i.test(body)) offenders.push(f);
      if (body.includes("lib/equipment")) offenders.push(f + " (imports the registry)");
    }
    expect(offenders).toEqual([]);
  });

  it("the load pipeline never reads pulleyRatioKind", () => {
    // Everything that computes or feeds load math: adapters + progression route.
    for (const p of ["src/lib/coreAdapters.ts", "src/app/api/progression/route.ts", "src/app/api/exercises/[id]/last-session/route.ts"]) {
      expect(read(p).includes("pulleyRatio")).toBe(false);
    }
  });
});
