import { offsetPatch } from "./equipment";

// Retroactive built-in correction.
//
// WHY this reaches backward when field-config changes don't: a machine's
// carriage has always weighed what it weighs. A wrong `built_in_weight` is a
// RECORDING ERROR, and every affected row was always the corrected number.
// A field-config change is different — there, the shape of what was logged
// genuinely changed, so it stays forward-only.
//
// The arithmetic is `offsetPatch`, shared with the session card so it cannot
// drift between the two. `load_entered` is never rewritten: it is what you
// physically put on the machine, and no correction to the carriage changes it.

export interface CorrectableRow {
  id: number;
  date: string;
  exercise: string;
  load: number;
  loadEntered: number | null;
  builtinOffset: number | null;
  reps: number;
}

export interface RowChange {
  id: number;
  date: string;
  exercise: string;
  reps: number;
  loadBefore: number;
  loadAfter: number;
  loadEntered: number;
  offsetBefore: number | null;
  offsetAfter: number | null;
}

export interface CorrectionPlan {
  changes: RowChange[];
  firstDate: string | null;
  lastDate: string | null;
  /** Rows whose stored values already match the target — nothing to write. */
  unchanged: number;
}

/**
 * What correcting this unit's built-in to `newOffset` would do.
 *
 * Rows are split by the caller: `withOffset` rows already carry a built-in and
 * are simply re-based; `nullOffset` rows never had one, and giving them one is
 * a DIFFERENT assertion (it claims you were always lifting more than recorded),
 * which is why the caller opts into them separately.
 */
export function planCorrection(rows: CorrectableRow[], newOffset: number): CorrectionPlan {
  const changes: RowChange[] = [];
  let unchanged = 0;
  for (const r of rows) {
    const patched = offsetPatch(
      { load: r.load, loadEntered: r.loadEntered, builtinOffset: r.builtinOffset },
      newOffset
    );
    // A no-op row is not a change — never write a row to the same value.
    if (patched.load === r.load && (patched.builtinOffset ?? null) === (r.builtinOffset ?? null)) {
      unchanged += 1;
      continue;
    }
    changes.push({
      id: r.id,
      date: r.date,
      exercise: r.exercise,
      reps: r.reps,
      loadBefore: r.load,
      loadAfter: patched.load,
      // Preserved by construction — surfaced so the preview can show it held.
      loadEntered: patched.loadEntered ?? r.loadEntered ?? r.load - (r.builtinOffset ?? 0),
      offsetBefore: r.builtinOffset ?? null,
      offsetAfter: patched.builtinOffset ?? null,
    });
  }
  const dates = changes.map((c) => c.date).sort();
  return {
    changes,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    unchanged,
  };
}

export interface Disagreement {
  offset: number;
  count: number;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Rows on a unit whose recorded built-in differs from the unit's own.
 *
 * This is how the 24res case surfaces: three sets logged against the
 * plate-loaded TYPE default (25) before the unit existed, then attributed to a
 * unit that records 24. Nothing changed to trigger a correction — the
 * disagreement was already there, so detection has to be always-on and
 * read-only rather than something a change event fires.
 */
export function findDisagreements(rows: CorrectableRow[], unitBuiltIn: number | null): Disagreement[] {
  const by = new Map<number, CorrectableRow[]>();
  for (const r of rows) {
    if (r.builtinOffset == null) continue; // a missing offset is absence, not disagreement
    if (unitBuiltIn != null && r.builtinOffset === unitBuiltIn) continue;
    // With no recorded built-in there is nothing to disagree WITH.
    if (unitBuiltIn == null) continue;
    (by.get(r.builtinOffset) ?? by.set(r.builtinOffset, []).get(r.builtinOffset)!).push(r);
  }
  return [...by.entries()]
    .map(([offset, rs]) => {
      const dates = rs.map((r) => r.date).sort();
      return { offset, count: rs.length, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
    })
    .sort((a, b) => b.count - a.count || a.offset - b.offset);
}
