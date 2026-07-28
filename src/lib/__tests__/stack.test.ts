import { describe, it, expect } from "vitest";
import { suggestPlateIncrement, findIncrementDisagreement, selectableLoads, formatSelectableLoads, parseStackMarking, resolveWeightUnit, formatDualWeight } from "../stack";

describe("increment disagreement — the record vs the rows", () => {
  it("fires on the real VSL10 case: logs step 20, the unit says 10", () => {
    expect(findIncrementDisagreement(10, [300, 320, 340])).toEqual({ stored: 10, logged: 20 });
  });

  it("is SILENT when the add-on explains a finer GCD", () => {
    // A 10 plate with a 5 lever selects 10, 15, 20, 25… so these loads are all
    // legitimate and their GCD of 5 says nothing about the plate. Firing here
    // would make the hint constant noise on every unit with a lever.
    expect(findIncrementDisagreement(10, [15, 25, 35])).toBeNull();
  });

  it("is silent when they agree", () => {
    expect(findIncrementDisagreement(10, [140, 150, 160])).toBeNull();
  });

  it("is silent with nothing stored — there is nothing to disagree WITH", () => {
    expect(findIncrementDisagreement(null, [300, 320, 340])).toBeNull();
    expect(findIncrementDisagreement(0, [300, 320, 340])).toBeNull();
  });

  it("is silent on too little history — under 3 distinct loads claims nothing", () => {
    expect(findIncrementDisagreement(10, [300, 340])).toBeNull();
    expect(findIncrementDisagreement(10, [])).toBeNull();
    expect(findIncrementDisagreement(10, [200, 200, 200])).toBeNull();
  });

  it("is silent when the derived step is unrelated rather than coarser", () => {
    // GCD 15 against a stored 20: not a multiple, so the logs aren't simply
    // skipping the finer notches — something else is going on, and a hint that
    // says "your logs all step 15" would be asserting more than it knows.
    expect(findIncrementDisagreement(20, [30, 45, 60])).toBeNull();
  });

  it("stops firing the moment the stored value is corrected", () => {
    expect(findIncrementDisagreement(20, [300, 320, 340])).toBeNull();
  });
});

// The suggestion is a LOWER BOUND on the plate size, not a measurement — which
// is exactly why the form offers it rather than applying it.
describe("plate-increment suggestion (GCD of logged loads)", () => {
  it("finds the grid when the loads expose it", () => {
    expect(suggestPlateIncrement([140, 150, 160])).toBe(10);
    expect(suggestPlateIncrement([300, 320, 340])).toBe(20);
    expect(suggestPlateIncrement([110, 120, 130, 120])).toBe(10); // duplicates ignored
  });

  it("an add-on lever shows up as the finer step, not the plate", () => {
    // 10 lb plates with a 5 lb add-on select 10/15/20 — GCD is 5, the true
    // finest step. Correct as a lower bound; the user overrides to 10 if the
    // plate is what they meant.
    expect(suggestPlateIncrement([100, 105, 115])).toBe(5);
  });

  it("stays silent without enough signal", () => {
    expect(suggestPlateIncrement([])).toBeNull();
    expect(suggestPlateIncrement([100])).toBeNull();
    expect(suggestPlateIncrement([100, 110])).toBeNull(); // < 3 distinct
    expect(suggestPlateIncrement([100, 100, 100])).toBeNull(); // 1 distinct
  });

  it("refuses to guess a grid that isn't one", () => {
    expect(suggestPlateIncrement([100, 111, 130])).toBeNull(); // GCD 1
    expect(suggestPlateIncrement([264.55, 100, 150])).toBeNull(); // fractional
    expect(suggestPlateIncrement([0, -5, 100, 150, 200])).toBe(50); // junk filtered
  });
});

// The preview is what explains the three Stack fields — showing the grid beats
// describing it, and a wrong entry produces an obviously wrong line.
describe("selectable loads (the stack grid)", () => {
  it("a plain stack steps by the plate", () => {
    expect(selectableLoads(10, null, 50)).toEqual([10, 20, 30, 40, 50]);
  });

  it("an add-on lever fills in the gaps rather than shifting the grid", () => {
    // The lever is engaged or not — so each pin position gains a second option.
    expect(selectableLoads(10, 5, 40)).toEqual([10, 15, 20, 25, 30, 35, 40]);
  });

  it("never exceeds the stack ceiling", () => {
    expect(selectableLoads(10, 5, 22)).toEqual([10, 15, 20]);
    expect(selectableLoads(100, null, 240)).toEqual([100, 200]);
  });

  it("stays silent when it cannot compute a grid", () => {
    expect(selectableLoads(null, 5, 240)).toEqual([]); // no plate
    expect(selectableLoads(10, 5, null)).toEqual([]); // no max
    expect(selectableLoads(0, 5, 240)).toEqual([]); // nonsense plate
    expect(selectableLoads(10, 5, 5)).toEqual([]); // max below one plate
    expect(selectableLoads(0.1, null, 10_000)).toEqual([]); // absurd ratio, capped
  });

  it("formats head … max, and the owner's two spot-checks", () => {
    expect(formatSelectableLoads(selectableLoads(10, 5, 240), "lb")).toBe("10, 15, 20 … 240 lb");
    expect(formatSelectableLoads(selectableLoads(10, null, 240), "lb")).toBe("10, 20, 30 … 240 lb");
  });

  it("shows a short grid whole rather than eliding almost nothing", () => {
    expect(formatSelectableLoads(selectableLoads(10, null, 40), "lb")).toBe("10, 20, 30, 40 lb");
    expect(formatSelectableLoads([], "lb")).toBeNull();
  });

  it("renders through the caller's unit conversion", () => {
    // kg display of a 10/240 lb stack — storage is untouched, this is display.
    const kg = (lb: number) => String(Math.round((lb / 2.2046226218) * 10) / 10);
    expect(formatSelectableLoads(selectableLoads(10, null, 240), "kg", kg)).toBe("4.5, 9.1, 13.6 … 108.9 kg");
  });
});

// Tri-state lock: NULL is ABSENCE, not lb. Defaulting a missing marking to lb
// would assert something the user never said — and on a genuinely kg-marked
// machine it would reproduce the kg-slip error in the opposite direction.
describe("stack marking is a tri-state, and a recorded one wins", () => {
  it("parses only real markings; everything else is not-recorded", () => {
    expect(parseStackMarking("lb")).toBe("lb");
    expect(parseStackMarking("kg")).toBe("kg");
    expect(parseStackMarking(null)).toBeNull();
    expect(parseStackMarking("")).toBeNull();
    expect(parseStackMarking("LB")).toBeNull(); // not a silent coercion
    expect(parseStackMarking(undefined)).toBeNull();
  });

  it("not recorded falls back to the preference — both ways", () => {
    expect(resolveWeightUnit(null, "lb")).toBe("lb");
    expect(resolveWeightUnit(null, "kg")).toBe("kg");
  });

  it("a recorded marking overrides the preference — both ways", () => {
    expect(resolveWeightUnit("lb", "kg")).toBe("lb"); // the 264.55 case
    expect(resolveWeightUnit("kg", "lb")).toBe("kg"); // and its mirror
    expect(resolveWeightUnit("lb", "lb")).toBe("lb");
    expect(resolveWeightUnit("kg", "kg")).toBe("kg");
  });

  it("NULL is not a disguised lb default", () => {
    // The distinction that matters: with a kg preference, an unrecorded machine
    // must NOT be pinned to lb.
    expect(resolveWeightUnit(null, "kg")).not.toBe("lb");
  });
});

// Built-in resolves through the SAME path as the stack fields — one machine, one
// unit. A form that showed Stack in kg and Load in lb would describe one machine
// in two units, which is the confusion the marking exists to remove.
describe("built-in weight resolves like the stack fields", () => {
  const stackField = (marking: ReturnType<typeof parseStackMarking>, pref: "lb" | "kg") =>
    resolveWeightUnit(marking, pref);
  const builtIn = (marking: ReturnType<typeof parseStackMarking>, pref: "lb" | "kg") =>
    resolveWeightUnit(marking, pref); // identical by construction — that IS the lock

  it("agrees with the stack fields for every marking/preference pair", () => {
    for (const marking of ["lb", "kg", null] as const) {
      for (const pref of ["lb", "kg"] as const) {
        expect(builtIn(marking, pref)).toBe(stackField(marking, pref));
      }
    }
  });

  it("a kg-marked machine reads BOTH in kg regardless of preference", () => {
    expect(builtIn("kg", "lb")).toBe("kg");
    expect(stackField("kg", "lb")).toBe("kg");
  });

  it("an unrecorded machine follows the preference for both", () => {
    expect(builtIn(null, "kg")).toBe("kg");
    expect(stackField(null, "kg")).toBe("kg");
    expect(builtIn(null, "lb")).toBe("lb");
  });
});

// Dual display exists for one situation: a machine marked in a unit that isn't
// the one you think in. Everywhere else it must be invisible.
describe("dual weight display — only on a real mismatch", () => {
  const fmt = (lb: number, u: "lb" | "kg") =>
    u === "kg" ? String(Math.round((lb / 2.2046226218) * 10) / 10) : String(lb);

  it("shows the machine's unit first and yours in parentheses", () => {
    // Travelling: you read lb, the machine is stamped kg.
    expect(formatDualWeight(132.28, "kg", "lb", fmt)).toBe("60 kg (132.28 lb)");
  });

  it("shows a SINGLE value when the machine matches your preference", () => {
    // The owner's real case — all 18 units lb, preference lb.
    expect(formatDualWeight(120, "lb", "lb", fmt)).toBe("120 lb");
    expect(formatDualWeight(120, "kg", "kg", fmt)).toBe("54.4 kg");
  });

  it("shows a SINGLE value when the machine records nothing", () => {
    // Unrecorded already renders in the preference — a parenthetical would
    // repeat the same number in the same unit.
    expect(formatDualWeight(120, null, "lb", fmt)).toBe("120 lb");
    expect(formatDualWeight(120, null, "kg", fmt)).toBe("54.4 kg");
  });

  it("never emits a parenthetical in any matching combination", () => {
    for (const pref of ["lb", "kg"] as const) {
      expect(formatDualWeight(100, pref, pref, fmt)).not.toContain("(");
      expect(formatDualWeight(100, null, pref, fmt)).not.toContain("(");
    }
  });
});
