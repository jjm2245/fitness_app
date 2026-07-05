import { describe, it, expect } from "vitest";
import { findSubstitutionCandidates, rankSubstitutionCandidates } from "../substitution";
import type { ExerciseTags } from "../types";

// Fixtures mirror the seed's back_biceps day: cable_close_grip_row is tagged
// lumbar_spine and its own seed substitutions are a chest-supported machine row
// (back-friendly) and a bench-supported DB row.
const cableRow: ExerciseTags = {
  id: "cable_close_grip_row",
  movementPattern: "horizontal_pull",
  muscles: [
    { muscle: "rhomboids", role: "primary", emphasis: 1.0 },
    { muscle: "lats", role: "secondary", emphasis: 0.5 },
    { muscle: "mid_traps", role: "secondary", emphasis: 0.5 },
    { muscle: "biceps", role: "secondary", emphasis: 0.5 },
  ],
  equipmentRequired: ["cable"],
  affectedStructures: ["lumbar_spine"],
};

const chestSupportedRow: ExerciseTags = {
  id: "chest_supported_row",
  movementPattern: "horizontal_pull",
  muscles: [
    { muscle: "rhomboids", role: "primary", emphasis: 1.0 },
    { muscle: "mid_traps", role: "secondary", emphasis: 0.5 },
  ],
  equipmentRequired: ["row_machine"],
  affectedStructures: [], // back-friendly, per seed note
};

const dbSingleArmRow: ExerciseTags = {
  id: "db_single_arm_row",
  movementPattern: "horizontal_pull",
  muscles: [
    { muscle: "rhomboids", role: "primary", emphasis: 1.0 },
    { muscle: "lats", role: "secondary", emphasis: 0.5 },
    { muscle: "biceps", role: "secondary", emphasis: 0.5 },
  ],
  equipmentRequired: ["dumbbell", "bench"],
  affectedStructures: [],
};

const unavailableMachineRow: ExerciseTags = {
  id: "plate_loaded_row",
  movementPattern: "horizontal_pull",
  muscles: [{ muscle: "rhomboids", role: "primary", emphasis: 1.0 }],
  equipmentRequired: ["plate_loaded_row_machine"], // not in gym's available equipment
  affectedStructures: [],
};

const latPulldown: ExerciseTags = {
  id: "cable_lat_pulldown",
  movementPattern: "vertical_pull", // different pattern — must be excluded
  muscles: [{ muscle: "lats", role: "primary", emphasis: 1.0 }],
  equipmentRequired: ["lat_pulldown"],
  affectedStructures: [],
};

const rotaryTorsoLikeRow: ExerciseTags = {
  id: "loaded_lumbar_row_variant",
  movementPattern: "horizontal_pull",
  muscles: [{ muscle: "rhomboids", role: "primary", emphasis: 1.0 }],
  equipmentRequired: ["cable"],
  affectedStructures: ["lumbar_spine"], // contraindicated when lumbar_spine is active
};

const pool = [chestSupportedRow, dbSingleArmRow, unavailableMachineRow, latPulldown, rotaryTorsoLikeRow];
const availableEquipment = ["cable", "row_machine", "dumbbell", "bench"];

describe("findSubstitutionCandidates", () => {
  it("matches movement pattern + muscle overlap + available equipment, no active injuries", () => {
    const candidates = findSubstitutionCandidates({
      original: cableRow,
      pool,
      availableEquipment,
      activeInjuryStructures: [],
    });

    const ids = candidates.map((c) => c.id).sort();
    // rotaryTorsoLikeRow passes here since there's no active lumbar_spine flag yet.
    expect(ids).toEqual(["chest_supported_row", "db_single_arm_row", "loaded_lumbar_row_variant"]);
  });

  it("excludes candidates whose equipment isn't available", () => {
    const candidates = findSubstitutionCandidates({
      original: cableRow,
      pool,
      availableEquipment,
      activeInjuryStructures: [],
    });
    expect(candidates.find((c) => c.id === "plate_loaded_row")).toBeUndefined();
  });

  it("excludes candidates with a different movement pattern", () => {
    const candidates = findSubstitutionCandidates({
      original: cableRow,
      pool,
      availableEquipment,
      activeInjuryStructures: [],
    });
    expect(candidates.find((c) => c.id === "cable_lat_pulldown")).toBeUndefined();
  });

  it("excludes candidates with an active contraindicated structure (back-safety)", () => {
    const candidates = findSubstitutionCandidates({
      original: cableRow,
      pool,
      availableEquipment,
      activeInjuryStructures: ["lumbar_spine"],
    });

    const ids = candidates.map((c) => c.id).sort();
    expect(ids).toEqual(["chest_supported_row", "db_single_arm_row"]);
    expect(ids).not.toContain("loaded_lumbar_row_variant");
  });

  it("never returns the original exercise itself", () => {
    const candidates = findSubstitutionCandidates({
      original: cableRow,
      pool: [...pool, cableRow],
      availableEquipment,
      activeInjuryStructures: [],
    });
    expect(candidates.find((c) => c.id === cableRow.id)).toBeUndefined();
  });
});

describe("rankSubstitutionCandidates", () => {
  it("ranks the closer muscle-emphasis match higher", () => {
    const candidates = findSubstitutionCandidates({
      original: cableRow,
      pool,
      availableEquipment,
      activeInjuryStructures: ["lumbar_spine"],
    });
    const ranked = rankSubstitutionCandidates(cableRow, candidates);

    // db_single_arm_row shares rhomboids + lats with cableRow; chest_supported_row
    // only shares rhomboids + mid_traps — db row's profile is the closer match.
    expect(ranked[0].exercise.id).toBe("db_single_arm_row");
  });
});
