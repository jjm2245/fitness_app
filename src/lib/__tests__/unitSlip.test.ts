import { describe, it, expect } from "vitest";
import { detectUnitSlip, recentLoadsFromLastText } from "../unitSlip";
import { kgToLb } from "../units";

const check = (typed: number, recent: number[], entryUnit = "kg") => ({
  typed, canonical: entryUnit === "kg" ? kgToLb(typed) : typed,
  entryUnit, canonicalUnit: "lb", recentCanonical: recent,
});

describe("unit-slip detection — fires on the slip shape only", () => {
  it("the owner's actual bug: 120 typed in kg mode at a 120-lb machine", () => {
    const w = detectUnitSlip(check(120, [120, 130, 130, 120]));
    expect(w).not.toBeNull();
    expect(w!.typed).toBe(120);
    expect(Math.round(w!.canonical)).toBe(265);
    expect(w!.typical).toBe(125);
  });

  it("the Hammer Curls example", () => {
    const w = detectUnitSlip(check(50, [50, 50, 50]));
    expect(w).not.toBeNull();
    expect(Math.round(w!.canonical)).toBe(110);
  });

  it("stays silent when the CONVERTED value matches history — a real kg user", () => {
    // History ~110 lb; typing 50 kg = 110 lb is exactly right.
    expect(detectUnitSlip(check(50, [110, 110, 115]))).toBeNull();
  });

  it("stays silent on a genuine PR — the case a jump-warning would trip", () => {
    // 60 kg = 132 lb against a 110-lb history: raw 60 is nowhere near 110.
    expect(detectUnitSlip(check(60, [105, 110, 110]))).toBeNull();
  });

  it("never fires without history, but ONE prior load is enough", () => {
    expect(detectUnitSlip(check(120, []))).toBeNull();
    // The "last" line is one weight with several rep counts, so a single load
    // is the normal case — requiring two would silence the check in practice.
    expect(detectUnitSlip(check(120, [120]))).not.toBeNull();
    expect(detectUnitSlip(check(54.4, [120]))).toBeNull(); // honest kg, one load
  });

  it("never fires when entry is already canonical", () => {
    expect(detectUnitSlip(check(120, [120, 130], "lb"))).toBeNull();
  });

  it("ignores nonsense input", () => {
    expect(detectUnitSlip(check(0, [120, 130]))).toBeNull();
    expect(detectUnitSlip(check(-5, [120, 130]))).toBeNull();
    expect(detectUnitSlip(check(NaN, [120, 130]))).toBeNull();
  });

  // The whole point: it must be quiet across the owner's REAL ranges. Every
  // unit's observed min/max, entered honestly in kg, must not warn.
  it("is quiet for honest kg entry across every real unit range", () => {
    const realRanges: Array<[string, number, number]> = [
      ["24res", 124, 164], ["HackSquat", 195, 215], ["LifeFitnessShoulder", 50, 70],
      ["Pulldown304", 150, 170], ["VPL-SMBP", 135, 155], ["VSL02", 130, 130],
      ["VSL03", 70, 100], ["VSL04", 120, 140], ["VSL06", 180, 190],
      ["VSL09", 140, 160], ["VSL10", 300, 340], ["VSL11", 170, 180],
      ["VSL13", 100, 190], ["VSL14", 110, 120], ["VSL16", 140, 150],
      ["VSL18", 100, 130], ["VSL20", 120, 140], ["longpull302", 120, 130],
    ];
    for (const [label, lo, hi] of realRanges) {
      const history = [lo, (lo + hi) / 2, hi];
      const typicalLb = (lo + hi) / 2;
      // Someone genuinely working in kg types the kg equivalent of their load.
      const honestKg = Math.round((typicalLb / 2.2046226218) * 10) / 10;
      expect(detectUnitSlip(check(honestKg, history)), `${label} honest kg entry`).toBeNull();
    }
  });

  it("fires for a slip at every real unit range", () => {
    const ranges: Array<[number, number]> = [[124,164],[195,215],[50,70],[300,340],[110,120]];
    for (const [lo, hi] of ranges) {
      const history = [lo, (lo + hi) / 2, hi];
      const typical = (lo + hi) / 2;
      // Typing the lb stack number while the box is in kg.
      expect(detectUnitSlip(check(typical, history)), `slip at ${typical}`).not.toBeNull();
    }
  });
});

describe("recent loads from the last-reference line", () => {
  it("parses the canonical lb numbers the card already shows", () => {
    expect(recentLoadsFromLastText("120 lb × 10, 10, 8")).toEqual([120]);
    expect(recentLoadsFromLastText("120 lb × 10 · 130 lb × 8")).toEqual([120, 130]);
    expect(recentLoadsFromLastText("164.5 lb × 6")).toEqual([164.5]);
  });
  it("is empty when there is no prior data", () => {
    expect(recentLoadsFromLastText(null)).toEqual([]);
    expect(recentLoadsFromLastText("— no prior data")).toEqual([]);
  });
});
