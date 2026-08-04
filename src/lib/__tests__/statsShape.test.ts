import { describe, it, expect } from "vitest";
import {
  delta,
  deltaText,
  arc,
  sessionFigure,
  laneMode,
  tonnage,
  workingSetCount,
  groupLaneSessions,
  figureSets,
  type Figure,
  type StatSet, laneLabel, PORTABLE_LANE } from "../statsShape";

const set = (id: number, load: number, reps: number, over: Partial<StatSet> = {}): StatSet => ({
  id,
  setIndex: id,
  setType: "working",
  load,
  reps,
  dropGroup: null,
  ...over,
});

const fig = (load: number, reps: number, totalReps = reps): Figure => ({ load, reps, setId: 1, totalReps });

describe("delta grammar — all six states, loaded currency (checklist 1–2)", () => {
  it("state 1: +N lb — bright", () => {
    const d = delta(fig(120, 10), fig(130, 8), "loaded");
    expect(d).toMatchObject({ state: 1, tier: "bright", dLoad: 10 });
    expect(deltaText(d)).toBe("+10 lb");
  });

  it("state 2: same load · N more reps — bright", () => {
    const d = delta(fig(120, 10), fig(120, 12), "loaded");
    expect(d).toMatchObject({ state: 2, tier: "bright", dReps: 2 });
    expect(deltaText(d)).toBe("same load · 2 more reps");
  });

  it("state 3: held at N lb — quiet", () => {
    const d = delta(fig(120, 10), fig(120, 10), "loaded");
    expect(d).toMatchObject({ state: 3, tier: "quiet", load: 120 });
    expect(deltaText(d)).toBe("held at 120 lb");
  });

  it("state 4: same load · N fewer reps — quiet", () => {
    const d = delta(fig(120, 10), fig(120, 8), "loaded");
    expect(d).toMatchObject({ state: 4, tier: "quiet" });
    expect(deltaText(d)).toBe("same load · 2 fewer reps");
  });

  it("state 5: −N lb — quiet, regardless of reps", () => {
    const d = delta(fig(120, 10), fig(110, 15), "loaded");
    expect(d).toMatchObject({ state: 5, tier: "quiet", dLoad: -10 });
    expect(deltaText(d)).toBe("−10 lb");
  });

  it("state 6: first session on this machine — quiet; portable says 'first session'", () => {
    const d = delta(null, fig(120, 10), "loaded");
    expect(d).toMatchObject({ state: 6, tier: "quiet" });
    expect(deltaText(d)).toBe("first session on this machine");
    expect(deltaText(d, (n) => n, "lb", false)).toBe("first session");
  });

  it("the string converts through the display unit — stored values untouched (checklist 15)", () => {
    const d = delta(fig(120, 10), fig(130, 8), "loaded");
    // +10 lb rendered under a kg preference.
    expect(deltaText(d, (lb) => Math.round((lb / 2.2046226218) * 10) / 10, "kg")).toBe("+4.5 kg");
    expect(d.dLoad).toBe(10); // the structured value stays canonical lb
  });
});

describe("delta grammar — reps currency (checklist 2, 4)", () => {
  it("compares TOTAL session reps, not the top set", () => {
    const d = delta(fig(0, 10, 24), fig(0, 9, 27), "reps");
    expect(d).toMatchObject({ state: 1, tier: "bright", dReps: 3 });
    expect(deltaText(d)).toBe("+3 reps");
  });

  it("held and down are quiet; first is state 6", () => {
    expect(deltaText(delta(fig(0, 8, 24), fig(0, 8, 24), "reps"))).toBe("held at 24 reps");
    expect(delta(fig(0, 8, 24), fig(0, 8, 24), "reps").tier).toBe("quiet");
    expect(deltaText(delta(fig(0, 8, 24), fig(0, 8, 21), "reps"))).toBe("−3 reps");
    expect(delta(null, fig(0, 8, 24), "reps").state).toBe(6);
  });
});

describe("lane-aware previous session (checklist 1)", () => {
  it("Jul 21 (lane B) deltas against Jul 16 (lane B), never Jul 18 (lane A)", () => {
    // Interleaved: A = Jul 14/18/23/28, B = Jul 16/21. The caller walks ONE
    // lane's sessions; assert lane B's second session sees lane B's first.
    const rows = [
      { ...set(1, 100, 10), workoutLogId: 1, date: "2026-07-14", lane: "A" },
      { ...set(2, 200, 10), workoutLogId: 2, date: "2026-07-16", lane: "B" },
      { ...set(3, 110, 10), workoutLogId: 3, date: "2026-07-18", lane: "A" },
      { ...set(4, 210, 10), workoutLogId: 4, date: "2026-07-21", lane: "B" },
      { ...set(5, 120, 10), workoutLogId: 5, date: "2026-07-23", lane: "A" },
      { ...set(6, 130, 10), workoutLogId: 6, date: "2026-07-28", lane: "A" },
    ];
    const lanes = groupLaneSessions(rows);
    const b = lanes.get("B")!;
    expect(b.map((s) => s.date)).toEqual(["2026-07-16", "2026-07-21"]);
    const d = delta(sessionFigure(b[0].sets), sessionFigure(b[1].sets)!, "loaded");
    // +10 within lane B (200 → 210) — NOT −? anything against lane A's Jul 18.
    expect(deltaText(d)).toBe("+10 lb");
  });
});

describe("two sessions on one calendar date stay two sessions (checklist 6)", () => {
  it("groups by workout_logs.id, not date", () => {
    const rows = [
      { ...set(1, 100, 10), workoutLogId: 41, date: "2026-07-20", lane: "A" },
      { ...set(2, 105, 10), workoutLogId: 42, date: "2026-07-20", lane: "A" },
    ];
    const sessions = groupLaneSessions(rows).get("A")!;
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.workoutLogId)).toEqual([41, 42]);
    // And the second deltas against the first, same day or not.
    expect(deltaText(delta(sessionFigure(sessions[0].sets), sessionFigure(sessions[1].sets)!, "loaded"))).toBe("+5 lb");
  });
});

describe("figure, drops and warm-ups (checklist 3)", () => {
  it("a drop segment above the lane best never supplies the figure", () => {
    const sets = [
      set(1, 190, 6, { dropGroup: "g" }), // parent (lowest id in group)
      set(2, 900, 6, { dropGroup: "g" }), // segment — absurd load, still ignored
      set(3, 180, 8),
    ];
    expect(figureSets(sets).map((s) => s.id)).toEqual([1, 3]);
    expect(sessionFigure(sets)).toMatchObject({ load: 190, reps: 6 });
  });

  it("warm-ups never figure, and drop segments count toward sets and tonnage", () => {
    const sets = [
      set(1, 500, 3, { setType: "warmup" }),
      set(2, 130, 7, { dropGroup: "g" }),
      set(3, 100, 3, { dropGroup: "g" }),
    ];
    expect(sessionFigure(sets)).toMatchObject({ load: 130, reps: 7 });
    expect(workingSetCount(sets)).toBe(2); // segment counts, warm-up doesn't
    expect(tonnage(sets)).toBe(130 * 7 + 100 * 3); // no warm-up term
  });

  it("figure ties break by more reps, then lowest id", () => {
    expect(sessionFigure([set(1, 120, 8), set(2, 120, 10)])).toMatchObject({ setId: 2 });
    expect(sessionFigure([set(4, 120, 10), set(2, 120, 10)])).toMatchObject({ setId: 2 });
  });
});

describe("lane mode and the arc", () => {
  it("any working load > 0 makes a loaded lane; all-zero is a reps lane", () => {
    expect(laneMode([set(1, 0, 10), set(2, 25, 8)])).toBe("loaded");
    expect(laneMode([set(1, 0, 10), set(2, 0, 8)])).toBe("reps");
    expect(laneMode([set(1, 500, 3, { setType: "warmup" }), set(2, 0, 10)])).toBe("reps");
  });

  it("arc is net first→latest; single session is state 6", () => {
    expect(deltaText(arc(fig(140, 10), fig(160, 8), "loaded", 3))).toBe("+20 lb");
    expect(arc(fig(140, 10), fig(140, 10), "loaded", 1).state).toBe(6);
  });
});

describe("absence tokens never leak into rendered strings (NULL-spec unit)", () => {
  // The live subject is LifeFitnessShoulder — every spec NULL, pulley unknown.
  // Its LANE must render from label + logged loads alone; no string surface may
  // contain "null", "undefined" or "NaN".
  const leaky = (s: string) => /\bnull\b|\bundefined\b|\bNaN\b/i.test(s);
  const w = (lb: number) => String(lb);

  it("laneLabel: unit label, pooled 'unspecified', portable 'no machine' — never a token", () => {
    const labels = new Map([["lfs", "LifeFitnessShoulder"]]);
    for (const lane of ["lfs", "selectorized:unspecified", PORTABLE_LANE, "some-unknown-id"]) {
      const out = laneLabel(lane, labels);
      expect(leaky(out), out).toBe(false);
    }
    // An id with no unit row falls back to the ID STRING, not undefined.
    expect(laneLabel("ghost-id", labels)).toBe("ghost-id");
  });

  it("deltaText: all six states, both currencies, machine and no-machine — clean", () => {
    const figs: Array<[Figure | null, Figure]> = [
      [null, { load: 50, reps: 10, setId: 1, totalReps: 30 }],
      [{ load: 50, reps: 10, setId: 1, totalReps: 30 }, { load: 60, reps: 8, setId: 2, totalReps: 24 }],
      [{ load: 50, reps: 10, setId: 1, totalReps: 30 }, { load: 50, reps: 12, setId: 2, totalReps: 36 }],
      [{ load: 50, reps: 10, setId: 1, totalReps: 30 }, { load: 50, reps: 10, setId: 2, totalReps: 30 }],
      [{ load: 50, reps: 10, setId: 1, totalReps: 30 }, { load: 50, reps: 8, setId: 2, totalReps: 24 }],
      [{ load: 50, reps: 10, setId: 1, totalReps: 30 }, { load: 40, reps: 10, setId: 2, totalReps: 30 }],
    ];
    for (const mode of ["loaded", "reps"] as const) {
      for (const [prev, curr] of figs) {
        for (const hasUnit of [true, false]) {
          const out = deltaText(delta(prev, curr, mode), w, "lb", hasUnit);
          expect(leaky(out), out).toBe(false);
        }
      }
    }
  });
});
