import { describe, it, expect } from "vitest";
import {
  suggestSameSetup,
  suggestRatioEstimate,
  suggestFor,
  parseRatio,
  ratioEstimate,
  pairKey,
  type ComparabilityUnit,
} from "../comparability";

const unit = (id: string, over: Partial<ComparabilityUnit> = {}): ComparabilityUnit => ({
  id,
  label: id,
  equipmentType: "cable",
  pulleyRatioKind: "1:1",
  builtInWeight: null,
  plateIncrement: 10,
  addOnWeight: 5,
  stackMax: 200,
  stackUnit: "lb",
  ...over,
});

describe("same_setup (checklist 7)", () => {
  it("spec-identical cable pair → suggested, with an honest basis and no cam caveat", () => {
    const s = suggestSameSetup(unit("a"), unit("b"))!;
    expect(s.kind).toBe("same_setup");
    expect([s.a, s.b]).toEqual(["a", "b"]);
    expect(s.basis).toContain("identical setups");
    expect(s.basis).not.toMatch(/cam/i);
  });

  it("spec-identical SELECTORIZED pair → basis carries the cam caveat", () => {
    const s = suggestSameSetup(
      unit("vsl13", { equipmentType: "selectorized" }),
      unit("vsl16", { equipmentType: "selectorized" })
    )!;
    expect(s).not.toBeNull();
    expect(s.basis).toMatch(/cams differ across models/);
    expect(s.basis).toMatch(/same machine model/);
  });

  it("pulley must be KNOWN on both — two unknowns matching is not a match", () => {
    // The real MSP pair: VSL18 + LifeFitnessShoulder, both pulley 'unknown'.
    expect(
      suggestSameSetup(
        unit("vsl18", { equipmentType: "selectorized", pulleyRatioKind: "unknown" }),
        unit("lfs", { equipmentType: "selectorized", pulleyRatioKind: "unknown" })
      )
    ).toBeNull();
  });

  it("any differing structured fact kills it", () => {
    expect(suggestSameSetup(unit("a"), unit("b", { stackMax: 240 }))).toBeNull();
    expect(suggestSameSetup(unit("a"), unit("b", { plateIncrement: 20 }))).toBeNull();
    expect(suggestSameSetup(unit("a"), unit("b", { stackUnit: "kg" }))).toBeNull();
    expect(suggestSameSetup(unit("a"), unit("b", { equipmentType: "selectorized" }))).toBeNull();
    expect(suggestSameSetup(unit("a", { builtInWeight: 20 }), unit("b"))).toBeNull();
  });

  it("built-in both null/zero, or exactly equal, passes", () => {
    expect(suggestSameSetup(unit("a", { builtInWeight: 0 }), unit("b"))).not.toBeNull();
    expect(suggestSameSetup(unit("a", { builtInWeight: 20 }), unit("b", { builtInWeight: 20 }))).not.toBeNull();
  });
});

describe("ratio_estimate (checklist 7 + G2 mapping)", () => {
  const oneToOne = unit("st-a", { pulleyRatioKind: "1:1" });
  const twoToOne = unit("st-b", { pulleyRatioKind: "2:1" });

  it("plain cable stations, known differing ratios, no counterweight → suggested with the arithmetic", () => {
    const s = suggestRatioEstimate(oneToOne, twoToOne)!;
    expect(s.kind).toBe("ratio_estimate");
    expect(s.ratios).toEqual({ a: 1, b: 2 });
    expect(s.basis).toContain("est = load ÷ ratio");
  });

  it("a counterweight on EITHER unit kills it — additive terms break ratio math", () => {
    // Assist = negative built_in_weight in this schema (no counterweight column).
    expect(suggestRatioEstimate(unit("a", { builtInWeight: -30 }), twoToOne)).toBeNull();
    expect(suggestRatioEstimate(oneToOne, unit("b", { pulleyRatioKind: "2:1", builtInWeight: 15 }))).toBeNull();
  });

  it("cammed units NEVER receive it — same ratios, wrong type", () => {
    expect(
      suggestRatioEstimate(
        unit("a", { equipmentType: "selectorized" }),
        unit("b", { equipmentType: "selectorized", pulleyRatioKind: "2:1" })
      )
    ).toBeNull();
  });

  it("unknown or equal ratios → nothing", () => {
    expect(suggestRatioEstimate(oneToOne, unit("b", { pulleyRatioKind: "unknown" }))).toBeNull();
    expect(suggestRatioEstimate(oneToOne, unit("b", { pulleyRatioKind: "1:1" }))).toBeNull();
    expect(suggestRatioEstimate(oneToOne, unit("b", { pulleyRatioKind: "other" }))).toBeNull();
  });

  it("estimate math normalizes to the 1:1 equivalent", () => {
    expect(ratioEstimate(120, 2)).toBe(60);
    expect(ratioEstimate(120, 1)).toBe(120);
  });
});

describe("NULL-unit lanes and decisions (checklist 7–8)", () => {
  it("a NULL unit is never party to any suggestion", () => {
    expect(suggestSameSetup(null, unit("b"))).toBeNull();
    expect(suggestRatioEstimate(unit("a"), null)).toBeNull();
    expect(suggestFor([null, unit("a")], [])).toEqual([]);
  });

  it("a decided pair — confirmed OR rejected — is not re-suggested", () => {
    const a = unit("a");
    const b = unit("b");
    expect(suggestFor([a, b], []).map((s) => s.kind)).toEqual(["same_setup"]);
    expect(suggestFor([a, b], [{ a: "a", b: "b", kind: "same_setup" }])).toEqual([]);
  });

  it("pairKey orders lexicographically regardless of argument order", () => {
    expect(pairKey("z", "a")).toEqual(["a", "z"]);
    const s = suggestSameSetup(unit("z"), unit("a"))!;
    expect([s.a, s.b]).toEqual(["a", "z"]);
  });

  it("parseRatio accepts only N:1 forms", () => {
    expect(parseRatio("1:1")).toBe(1);
    expect(parseRatio("2:1")).toBe(2);
    expect(parseRatio("other")).toBeNull();
    expect(parseRatio("unknown")).toBeNull();
    expect(parseRatio(null)).toBeNull();
  });
});
