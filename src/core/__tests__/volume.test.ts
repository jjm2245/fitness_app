import { describe, it, expect } from "vitest";
import {
  countedSetContribution,
  volumeByMuscle,
  volumeByMuscleInRange,
  classifyVolumeZone,
  VOLUME_LANDMARKS,
} from "../volume";
import type { ExerciseTags, SetLogInput } from "../types";

// Fixture mirrors the real seed's deadlift node: hamstrings/glutes primary (1.0),
// spinal_erectors meaningful secondary (0.5), lats/forearms/upper_traps minor (0.3).
const deadlift: Pick<ExerciseTags, "muscles"> = {
  muscles: [
    { muscle: "hamstrings", role: "primary", emphasis: 1.0 },
    { muscle: "glutes", role: "primary", emphasis: 1.0 },
    { muscle: "spinal_erectors", role: "secondary", emphasis: 0.5 },
    { muscle: "lats", role: "secondary", emphasis: 0.3 },
    { muscle: "forearms", role: "secondary", emphasis: 0.3 },
    { muscle: "upper_traps", role: "secondary", emphasis: 0.3 },
  ],
};

const legExtension: Pick<ExerciseTags, "muscles"> = {
  muscles: [{ muscle: "quadriceps", role: "primary", emphasis: 1.0 }],
};

const exercisesById = { deadlift, machine_leg_extension: legExtension };

function set(overrides: Partial<SetLogInput>): SetLogInput {
  return {
    exerciseId: "deadlift",
    machineId: null,
    date: "2026-07-01",
    setType: "working",
    load: 100,
    reps: 8,
    rir: 2,
    ...overrides,
  };
}

describe("countedSetContribution", () => {
  it("counts 0 for warm-up sets regardless of exercise", () => {
    const result = countedSetContribution(set({ setType: "warmup" }), deadlift);
    expect(result).toEqual({});
  });

  it("counts full emphasis for a working set, including minor secondaries", () => {
    const result = countedSetContribution(set({ setType: "working" }), deadlift);
    expect(result).toEqual({
      hamstrings: 1.0,
      glutes: 1.0,
      spinal_erectors: 0.5,
      lats: 0.3,
      forearms: 0.3,
      upper_traps: 0.3,
    });
  });
});

describe("volumeByMuscle", () => {
  it("sums fractional contributions across sets and exercises", () => {
    const sets: SetLogInput[] = [
      set({ setType: "working" }),
      set({ setType: "working" }),
      set({ setType: "warmup" }), // should not count
      set({ exerciseId: "machine_leg_extension", setType: "working" }),
    ];

    const totals = volumeByMuscle(sets, exercisesById);

    expect(totals.hamstrings).toBeCloseTo(2.0);
    expect(totals.glutes).toBeCloseTo(2.0);
    expect(totals.spinal_erectors).toBeCloseTo(1.0);
    expect(totals.lats).toBeCloseTo(0.6);
    expect(totals.quadriceps).toBeCloseTo(1.0);
  });

  it("ignores sets referencing an unknown exercise id instead of throwing", () => {
    const totals = volumeByMuscle([set({ exerciseId: "not_a_real_exercise" })], exercisesById);
    expect(totals).toEqual({});
  });
});

describe("volumeByMuscleInRange", () => {
  it("only counts sets within the date window", () => {
    const sets: SetLogInput[] = [
      set({ date: "2026-06-20" }), // before window
      set({ date: "2026-07-02" }), // in window
      set({ date: "2026-07-10" }), // after window
    ];

    const totals = volumeByMuscleInRange(sets, exercisesById, "2026-07-01", "2026-07-07");
    expect(totals.hamstrings).toBeCloseTo(1.0);
  });
});

describe("classifyVolumeZone", () => {
  it("flags below-floor volume", () => {
    expect(classifyVolumeZone(VOLUME_LANDMARKS.floor - 1)).toBe("below_floor");
  });

  it("flags productive volume within the 10-20 band", () => {
    expect(classifyVolumeZone(VOLUME_LANDMARKS.productiveLow)).toBe("productive");
    expect(classifyVolumeZone(VOLUME_LANDMARKS.productiveHigh)).toBe("productive");
  });

  it("flags high volume above the productive ceiling", () => {
    expect(classifyVolumeZone(VOLUME_LANDMARKS.productiveHigh + 1)).toBe("high");
  });
});
