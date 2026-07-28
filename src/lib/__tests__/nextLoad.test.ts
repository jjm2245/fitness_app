import { describe, it, expect } from "vitest";
import {
  resolveIncrement,
  nextSelectableLoad,
  checkLoadSanity,
  ABSURD_LOAD_LB,
} from "../nextLoad";

const spec = (o: Partial<Parameters<typeof nextSelectableLoad>[1]> = {}) => ({
  storedIncrement: null,
  loggedLoads: [],
  addOn: null,
  max: null,
  ...o,
});

describe("increment resolution — stored, then history, then nothing", () => {
  it("prefers a stored increment", () => {
    expect(resolveIncrement(spec({ storedIncrement: 10, loggedLoads: [140, 150, 160] })))
      .toEqual({ increment: 10, source: "stored" });
  });

  it("derives from this lane's history when nothing is stored — the ACTUAL situation", () => {
    // Every one of the owner's 18 units has plate_increment NULL, so this is
    // the path that has to work or the feature ships doing nothing.
    expect(resolveIncrement(spec({ loggedLoads: [140, 150, 160] })))
      .toEqual({ increment: 10, source: "history" }); // VSL16, Leg Extensions
    expect(resolveIncrement(spec({ loggedLoads: [300, 320, 340] })))
      .toEqual({ increment: 20, source: "history" }); // VSL10
  });

  it("gives up rather than inventing a number when history is too thin", () => {
    expect(resolveIncrement(spec({ loggedLoads: [140, 150] })).increment).toBeNull(); // < 3 distinct
    expect(resolveIncrement(spec({ loggedLoads: [] })).increment).toBeNull();
    // A bodyweight lane: every load 0, so nothing to divide.
    expect(resolveIncrement(spec({ loggedLoads: [0, 0, 0] })).increment).toBeNull();
  });

  it("ignores a stored increment that isn't a usable step", () => {
    expect(resolveIncrement(spec({ storedIncrement: 0, loggedLoads: [140, 150, 160] })).source).toBe("history");
  });
});

describe("next selectable load", () => {
  it("names the next load with a stored increment", () => {
    expect(nextSelectableLoad(120, spec({ storedIncrement: 10 })))
      .toEqual({ kind: "load", load: 130, increment: 10, source: "stored" });
  });

  it("respects an add-on lever: 120 + a 10 plate and a 5 lever is 125, not 130", () => {
    const r = nextSelectableLoad(120, spec({ storedIncrement: 10, addOn: 5, max: 240 }));
    expect(r).toEqual({ kind: "load", load: 125, increment: 10, source: "stored" });
  });

  it("says the stack is topped out rather than suggesting an impossible load", () => {
    expect(nextSelectableLoad(240, spec({ storedIncrement: 10, max: 240 })))
      .toEqual({ kind: "at_max", max: 240 });
    // Also when the current load already sits above the max.
    expect(nextSelectableLoad(300, spec({ storedIncrement: 10, max: 240 })).kind).toBe("at_max");
  });

  it("steps plainly when no max is recorded — today's normal case", () => {
    expect(nextSelectableLoad(140, spec({ loggedLoads: [140, 150, 160] })))
      .toEqual({ kind: "load", load: 150, increment: 10, source: "history" });
  });

  it("falls back to unknown so the caller keeps the generic wording", () => {
    expect(nextSelectableLoad(100, spec()).kind).toBe("unknown");
    // Bodyweight: load 0, no unit, no grid. The generic "+5, start adding a
    // belt" wording is the right answer and must not be overridden.
    expect(nextSelectableLoad(0, spec({ loggedLoads: [0, 0, 0] })).kind).toBe("unknown");
  });
});

describe("load sanity — advisory, and quiet in the normal case", () => {
  it("is silent on every plausible entry, including a real PR", () => {
    // The bound must never be the thing that questions a genuine lift.
    for (const load of [45, 120, 185, 315, 405, 500, 700, 1100]) {
      expect(checkLoadSanity(load, null)).toBeNull();
    }
  });

  it("fires on the shapes a slip actually takes", () => {
    expect(checkLoadSanity(9999, null)).toEqual({ kind: "absurd" });
    expect(checkLoadSanity(12345, null)).toEqual({ kind: "absurd" });
    expect(checkLoadSanity(15000, null)).toEqual({ kind: "absurd" }); // 1500 with a decimal slip
    expect(checkLoadSanity(ABSURD_LOAD_LB, null)).toEqual({ kind: "absurd" });
    expect(checkLoadSanity(ABSURD_LOAD_LB - 1, null)).toBeNull();
  });

  it("questions a load above a KNOWN stack max, without asserting it's wrong", () => {
    expect(checkLoadSanity(400, 240)).toEqual({ kind: "above_stack", stackMax: 240 });
    expect(checkLoadSanity(240, 240)).toBeNull(); // at the max is fine
  });

  it("stays silent when no stack max is recorded — all 18 units today", () => {
    expect(checkLoadSanity(400, null)).toBeNull();
  });

  it("never fires on absence or nonsense input", () => {
    expect(checkLoadSanity(0, 240)).toBeNull();
    expect(checkLoadSanity(NaN, 240)).toBeNull();
  });
});
