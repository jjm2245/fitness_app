import { describe, it, expect } from "vitest";
import { planCorrection, findDisagreements, type CorrectableRow } from "../builtinCorrection";

const row = (o: Partial<CorrectableRow> & { id: number }): CorrectableRow => ({
  date: "2026-07-18", exercise: "Leverage Incline Chest Press",
  load: 164, loadEntered: 140, builtinOffset: 24, reps: 8, ...o,
});

// THE invariant: load = load_entered + builtin_offset, and load_entered never
// moves — it is what was physically put on the machine, which no correction to
// the carriage can change.
describe("correction arithmetic", () => {
  it("re-bases an offset row and preserves what was loaded", () => {
    const { changes } = planCorrection([row({ id: 1, load: 164, loadEntered: 140, builtinOffset: 24 })], 30);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ loadBefore: 164, loadAfter: 170, loadEntered: 140, offsetBefore: 24, offsetAfter: 30 });
    expect(changes[0].loadAfter).toBe(changes[0].loadEntered + 30); // invariant
  });

  it("the owner's 24res case: three rows at 25 align to 24 (125 → 124)", () => {
    const rows = [1, 2, 3].map((id) =>
      row({ id, date: "2026-07-14", load: 125, loadEntered: 100, builtinOffset: 25 })
    );
    const { changes, firstDate, lastDate } = planCorrection(rows, 24);
    expect(changes).toHaveLength(3);
    for (const c of changes) {
      expect(c.loadBefore).toBe(125);
      expect(c.loadAfter).toBe(124);
      expect(c.loadEntered).toBe(100); // untouched
      expect(c.loadAfter).toBe(c.loadEntered + 24);
    }
    expect(firstDate).toBe("2026-07-14");
    expect(lastDate).toBe("2026-07-14");
  });

  it("a NULL-offset row back-derives what was loaded from its stored total", () => {
    // No offset was ever applied, so the recorded load IS what went on.
    const { changes } = planCorrection([row({ id: 9, load: 100, loadEntered: null, builtinOffset: null })], 24);
    expect(changes[0]).toMatchObject({ loadBefore: 100, loadAfter: 124, loadEntered: 100, offsetBefore: null, offsetAfter: 24 });
  });

  it("rows already at the target are not rewritten", () => {
    const plan = planCorrection([row({ id: 1, load: 164, loadEntered: 140, builtinOffset: 24 })], 24);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it("correcting to zero clears the offset rather than storing a 0", () => {
    const { changes } = planCorrection([row({ id: 1, load: 164, loadEntered: 140, builtinOffset: 24 })], 0);
    expect(changes[0]).toMatchObject({ loadAfter: 140, offsetAfter: null });
  });

  it("a negative built-in (an assist) reduces the effective load", () => {
    const { changes } = planCorrection([row({ id: 1, load: 100, loadEntered: 100, builtinOffset: null })], -20);
    expect(changes[0]).toMatchObject({ loadAfter: 80, offsetAfter: -20, loadEntered: 100 });
  });
});

// Detection is always-on and read-only: the 24res disagreement pre-existed any
// change, so nothing would have fired a change-triggered check.
describe("disagreement detection", () => {
  it("surfaces rows whose offset differs from the unit's recorded built-in", () => {
    const rows = [
      row({ id: 1, date: "2026-07-14", builtinOffset: 25 }),
      row({ id: 2, date: "2026-07-14", builtinOffset: 25 }),
      row({ id: 3, date: "2026-07-14", builtinOffset: 25 }),
      row({ id: 4, date: "2026-07-18", builtinOffset: 24 }),
      row({ id: 5, date: "2026-07-25", builtinOffset: 24 }),
    ];
    const d = findDisagreements(rows, 24);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ offset: 25, count: 3, firstDate: "2026-07-14", lastDate: "2026-07-14" });
  });

  it("a consistent unit surfaces nothing", () => {
    expect(findDisagreements([row({ id: 1 }), row({ id: 2 })], 24)).toEqual([]);
  });

  it("absence is not disagreement", () => {
    // A NULL offset means no built-in was applied — not a conflicting claim.
    expect(findDisagreements([row({ id: 1, builtinOffset: null })], 24)).toEqual([]);
    // And with no recorded built-in there is nothing to disagree with.
    expect(findDisagreements([row({ id: 1, builtinOffset: 25 })], null)).toEqual([]);
  });

  it("reports each distinct offset separately, commonest first", () => {
    const rows = [
      row({ id: 1, builtinOffset: 25 }), row({ id: 2, builtinOffset: 25 }),
      row({ id: 3, builtinOffset: 20 }),
    ];
    const d = findDisagreements(rows, 24);
    expect(d.map((x) => [x.offset, x.count])).toEqual([[25, 2], [20, 1]]);
  });
});
