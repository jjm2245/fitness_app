import { describe, it, expect } from "vitest";
import {
  laneKey,
  groupSetsByLane,
  toSessionSummaries,
  resolveProgressionSignal,
} from "../machineTracking";
import type { SetLogInput } from "../types";

const context = { repRangeMax: 12, targetRir: 2 };

function workingSet(overrides: Partial<SetLogInput>): SetLogInput {
  return {
    exerciseId: "cable_lat_pulldown",
    machineId: "gym_a_pulldown_1",
    date: "2026-07-01",
    setType: "working",
    load: 100,
    reps: 8,
    rir: 2,
    ...overrides,
  };
}

describe("laneKey / groupSetsByLane", () => {
  it("groups portable sets (no machine_id) separately from machine-bound sets", () => {
    const sets = [
      workingSet({ machineId: null, exerciseId: "deadlift" }),
      workingSet({ machineId: "gym_a_pulldown_1" }),
      workingSet({ machineId: "gym_b_pulldown_3" }),
    ];
    const groups = groupSetsByLane(sets);
    expect(Object.keys(groups).sort()).toEqual(
      [
        laneKey("deadlift", null),
        laneKey("cable_lat_pulldown", "gym_a_pulldown_1"),
        laneKey("cable_lat_pulldown", "gym_b_pulldown_3"),
      ].sort()
    );
  });
});

describe("toSessionSummaries", () => {
  it("collapses same-day working sets into one session and drops warm-ups", () => {
    const sets = [
      workingSet({ date: "2026-07-01", setType: "warmup", load: 40, reps: 12 }),
      workingSet({ date: "2026-07-01", load: 100, reps: 8 }),
      workingSet({ date: "2026-07-01", load: 100, reps: 7 }),
      workingSet({ date: "2026-07-03", load: 105, reps: 8 }),
    ];
    const sessions = toSessionSummaries(sets);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].workingSets).toHaveLength(2);
  });
});

describe("resolveProgressionSignal", () => {
  it("re-baselines instead of flagging a stall right after a machine change", () => {
    const priorMachineHistory = [
      workingSet({ machineId: "gym_a_pulldown_1", date: "2026-06-20", load: 100, reps: 8 }),
      workingSet({ machineId: "gym_a_pulldown_1", date: "2026-06-24", load: 100, reps: 8 }),
      workingSet({ machineId: "gym_a_pulldown_1", date: "2026-06-27", load: 100, reps: 8 }),
    ];
    const oneSetOnNewMachine = workingSet({
      machineId: "gym_b_pulldown_3",
      date: "2026-07-01",
      load: 60,
      reps: 8,
    });

    const result = resolveProgressionSignal(
      [...priorMachineHistory, oneSetOnNewMachine],
      "gym_b_pulldown_3",
      context
    );

    expect(result.status).toBe("new_machine_baseline");
  });

  it("runs normal stall detection once there's enough history on the current machine", () => {
    const sameMachineHistory = [
      workingSet({ machineId: "gym_b_pulldown_3", date: "2026-06-20", load: 60, reps: 8 }),
      workingSet({ machineId: "gym_b_pulldown_3", date: "2026-06-24", load: 60, reps: 8 }),
      workingSet({ machineId: "gym_b_pulldown_3", date: "2026-06-27", load: 60, reps: 8 }),
    ];

    const result = resolveProgressionSignal(sameMachineHistory, "gym_b_pulldown_3", {
      ...context,
      stallSessionThreshold: 3,
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.signal.type).toBe("true_stall");
    }
  });

  it("treats portable (machineId null) sets as always continuous — no re-baselining", () => {
    const sets = [
      workingSet({ machineId: null, exerciseId: "deadlift", date: "2026-06-20", load: 90, reps: 8 }),
      workingSet({ machineId: null, exerciseId: "deadlift", date: "2026-06-24", load: 95, reps: 8 }),
    ];
    const result = resolveProgressionSignal(sets, null, context);
    expect(result.status).toBe("resolved");
  });
});
