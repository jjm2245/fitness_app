import { describe, it, expect } from "vitest";
import { countTrailingFlatSessions, nextStallIntervention, STALL_INTERVENTION_LADDER } from "../stallBuster";
import type { SessionSummary } from "../progression";

const targetRir = 2;

function session(date: string, load: number, reps: number, rir = 2): SessionSummary {
  return { date, workingSets: [{ load, reps, rir }] };
}

describe("countTrailingFlatSessions", () => {
  it("returns 0 for no sessions", () => {
    expect(countTrailingFlatSessions([], targetRir)).toBe(0);
  });

  it("counts a single session as 1", () => {
    expect(countTrailingFlatSessions([session("2026-06-20", 100, 8)], targetRir)).toBe(1);
  });

  it("counts consecutive identical trailing sessions", () => {
    const sessions = [
      session("2026-06-20", 100, 8),
      session("2026-06-24", 100, 8),
      session("2026-06-27", 100, 8),
    ];
    expect(countTrailingFlatSessions(sessions, targetRir)).toBe(3);
  });

  it("stops counting at the first session that breaks the pattern (scanning from most recent)", () => {
    const sessions = [
      session("2026-06-13", 95, 8),
      session("2026-06-20", 100, 8),
      session("2026-06-24", 100, 8),
      session("2026-06-27", 100, 8),
    ];
    expect(countTrailingFlatSessions(sessions, targetRir)).toBe(3);
  });

  it("does not count sessions where effort was above target RIR (not a real stall)", () => {
    const sessions = [
      session("2026-06-20", 100, 8, 5),
      session("2026-06-24", 100, 8, 5),
    ];
    expect(countTrailingFlatSessions(sessions, targetRir)).toBe(1);
  });
});

describe("nextStallIntervention", () => {
  it("starts at the first rung right at the stall threshold", () => {
    const sessions = [
      session("2026-06-20", 100, 8),
      session("2026-06-24", 100, 8),
      session("2026-06-27", 100, 8),
    ];
    const result = nextStallIntervention(sessions, targetRir, 3);
    expect(result.id).toBe(STALL_INTERVENTION_LADDER[0].id);
  });

  it("escalates rungs as the stall persists beyond the threshold", () => {
    const sessions = [
      session("2026-06-13", 100, 8),
      session("2026-06-17", 100, 8),
      session("2026-06-20", 100, 8),
      session("2026-06-24", 100, 8),
      session("2026-06-27", 100, 8),
    ];
    const result = nextStallIntervention(sessions, targetRir, 3);
    expect(result.id).toBe(STALL_INTERVENTION_LADDER[2].id);
  });

  it("caps at the last rung (deload) instead of going out of bounds", () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      session(`2026-01-${String(i + 1).padStart(2, "0")}`, 100, 8)
    );
    const result = nextStallIntervention(sessions, targetRir, 3);
    expect(result.id).toBe(STALL_INTERVENTION_LADDER[STALL_INTERVENTION_LADDER.length - 1].id);
  });
});
