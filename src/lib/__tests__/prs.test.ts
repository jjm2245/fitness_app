import { describe, it, expect } from "vitest";
import { markPrs, wouldBePr, type PrSet } from "../prs";

const s = (key: number, load: number, over: Partial<PrSet> = {}): PrSet => ({
  key, load, setType: "working", isDropSegment: false, ...over,
});

describe("PR marking — strictly greater, per lane, weight only", () => {
  it("the owner's case: 180 -> 190 -> 180 marks only the 190", () => {
    // The lane's first three sets: the opening 180 is the BASELINE, not a PR.
    expect([...markPrs([s(1, 180), s(2, 190), s(3, 180)], null)]).toEqual([2]);
    // Same shape on a lane that already held 180 — the tie doesn't fire either.
    expect([...markPrs([s(1, 180), s(2, 190), s(3, 180)], 180)]).toEqual([2]);
  });

  it("a later 195 leaves the 190 marked too — a lane reads as a progression", () => {
    const prs = markPrs([s(1, 180), s(2, 190), s(3, 180), s(4, 195)], 180);
    expect([...prs].sort()).toEqual([2, 4]);
  });

  it("a TIE is not a PR", () => {
    expect(markPrs([s(1, 190)], 190).size).toBe(0);
    expect(markPrs([s(1, 190), s(2, 190)], 180)).toEqual(new Set([1]));
  });

  it("the first working set on a fresh lane is never a PR", () => {
    // Nothing to have exceeded; on a new machine every early set would fire.
    expect(markPrs([s(1, 200)], null).size).toBe(0);
    // ...but it becomes the bar for what follows.
    expect(markPrs([s(1, 200), s(2, 205)], null)).toEqual(new Set([2]));
  });

  it("warm-ups never PR, even above the best, and never raise the bar", () => {
    const prs = markPrs([s(1, 500, { setType: "warmup" }), s(2, 185)], 180);
    expect(prs).toEqual(new Set([2])); // the 500 warm-up neither fired nor blocked
  });

  it("a DROP SEGMENT is never a PR and never moves the bar", () => {
    // The parent at 190 sets the record; the 100 segment is the same set
    // continued lighter. A segment ABOVE the bar still cannot fire.
    const prs = markPrs(
      [s(1, 190), s(2, 100, { isDropSegment: true }), s(3, 195)],
      180
    );
    expect(prs).toEqual(new Set([1, 3]));
    expect(markPrs([s(1, 300, { isDropSegment: true })], 100).size).toBe(0);
  });

  it("BODYWEIGHT lanes never produce one — every load ties at 0", () => {
    // Falls out of weight-only rather than being special-cased. Recorded in
    // DECISIONS so it is not later filed as a bug.
    expect(markPrs([s(1, 0), s(2, 0), s(3, 0)], null).size).toBe(0);
    expect(markPrs([s(1, 0), s(2, 0)], 0).size).toBe(0);
  });

  it("added weight on a bodyweight lane DOES PR — the rule is load, not equipment", () => {
    expect(markPrs([s(1, 25)], 0)).toEqual(new Set([1]));
  });

  it("keeps logged order — an out-of-order list would mark the wrong rows", () => {
    // 190 then 185: only the 190 fires. Reversed, both would.
    expect(markPrs([s(1, 190), s(2, 185)], 180)).toEqual(new Set([1]));
    expect(markPrs([s(2, 185), s(1, 190)], 180)).toEqual(new Set([2, 1]));
  });
});

describe("wouldBePr — the single-set form", () => {
  it("needs a prior best to beat", () => {
    expect(wouldBePr(200, null)).toBe(false);
    expect(wouldBePr(200, 190)).toBe(true);
    expect(wouldBePr(190, 190)).toBe(false);
    expect(wouldBePr(0, 0)).toBe(false);
  });
});
