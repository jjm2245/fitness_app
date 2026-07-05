import { describe, it, expect } from "vitest";
import { classifyProgression, sessionVolumeLoad, type SessionSummary } from "../progression";

const context = { repRangeMax: 12, targetRir: 2 };

function session(date: string, sets: Array<[number, number, number]>): SessionSummary {
  return {
    date,
    workingSets: sets.map(([load, reps, rir]) => ({ load, reps, rir })),
  };
}

describe("sessionVolumeLoad", () => {
  it("sums load x reps across working sets", () => {
    const s = session("2026-07-01", [
      [100, 8, 2],
      [100, 8, 2],
    ]);
    expect(sessionVolumeLoad(s)).toBe(1600);
  });
});

describe("classifyProgression", () => {
  it("reports insufficient_data with fewer than 2 sessions", () => {
    const result = classifyProgression([session("2026-07-01", [[100, 8, 2]])], context);
    expect(result.type).toBe("insufficient_data");
  });

  it("recommends increase_load when the top of the rep range is hit at or below target RIR", () => {
    const sessions = [
      session("2026-07-01", [[100, 10, 2]]),
      session("2026-07-03", [[100, 12, 1]]),
    ];
    const result = classifyProgression(sessions, context);
    expect(result.type).toBe("increase_load");
  });

  it("recommends progressing when reps rise at the same load", () => {
    const sessions = [
      session("2026-07-01", [[100, 8, 3]]),
      session("2026-07-03", [[100, 10, 2]]),
    ];
    const result = classifyProgression(sessions, context);
    expect(result.type).toBe("progressing");
  });

  it("flags regression after 2+ consecutive volume-load drops", () => {
    const sessions = [
      session("2026-06-27", [[100, 10, 2]]),
      session("2026-06-29", [[95, 9, 2]]),
      session("2026-07-01", [[90, 8, 2]]),
    ];
    const result = classifyProgression(sessions, context);
    expect(result.type).toBe("regression");
  });

  it("flags a true stall when load and reps are flat at target effort for the threshold window", () => {
    const sessions = [
      session("2026-06-20", [[100, 8, 2]]),
      session("2026-06-24", [[100, 8, 2]]),
      session("2026-06-27", [[100, 8, 2]]),
    ];
    const result = classifyProgression(sessions, { ...context, stallSessionThreshold: 3 });
    expect(result.type).toBe("true_stall");
  });

  it("does not flag a stall if effort is not actually at target (sandbagging with high RIR)", () => {
    const sessions = [
      session("2026-06-20", [[100, 8, 5]]),
      session("2026-06-24", [[100, 8, 5]]),
      session("2026-06-27", [[100, 8, 5]]),
    ];
    const result = classifyProgression(sessions, { ...context, stallSessionThreshold: 3 });
    expect(result.type).not.toBe("true_stall");
  });

  it("holds when there's no clear signal yet", () => {
    const sessions = [
      session("2026-06-20", [[100, 8, 3]]),
      session("2026-06-24", [[102, 8, 3]]),
    ];
    const result = classifyProgression(sessions, context);
    expect(result.type).toBe("hold");
  });
});
