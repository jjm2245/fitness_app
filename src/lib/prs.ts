// Personal records — WEIGHT ONLY, PER LANE, computed and never stored.
//
// A PR is a working set whose load strictly exceeded every working set
// previously logged on the same lane, where a lane is (exercise, unit) —
// including the portable lane where the unit is NULL.
//
// Per lane is the whole point: 190 lb on VSL13 is a best on VSL13, not on
// "Butterfly" generally. Two machines with different cams, pulleys or starting
// resistance don't produce comparable numbers, which is the reason lanes exist
// everywhere else in this app.
//
// Nothing here is persisted. A PR is a fact about a set's position in its
// lane's history, so it is derivable from `set_logs` alone and storing it would
// create a second copy that could disagree — the class of bug the divergence
// audit spent a round removing.

export interface PrSet {
  /** Whatever the caller uses to identify a row back to itself. */
  key: string | number;
  /** Canonical lb, the EFFECTIVE total (entered + built-in) — the same number
   *  the set rows display and the core reads. */
  load: number;
  setType: "warmup" | "working";
  /** A reduced-load continuation of the set above it, not a set of its own. */
  isDropSegment: boolean;
}

/**
 * Which of these sets were a PR AT THE MOMENT THEY WERE LOGGED.
 *
 * `sets` must be in logged order. `priorBest` is the lane's best working load
 * from BEFORE this list (null = the lane has no earlier history at all).
 *
 * A set keeps its mark after being beaten. That is deliberate: it was a best
 * when it happened, and keeping it is what makes a lane read as a progression
 * rather than one highlighted row.
 */
export function markPrs(sets: PrSet[], priorBest: number | null): Set<string | number> {
  const prs = new Set<string | number>();
  let best = priorBest;
  for (const s of sets) {
    // Warm-ups are not attempts at a best, and a heavy warm-up tag is a
    // mislabel rather than a record.
    if (s.setType !== "working") continue;
    // A drop segment carries a REDUCED load by definition — it is the same set
    // continued lighter, so it can neither set a record nor raise the bar for
    // what follows. (Part B removes it from the `last …` line for the same
    // reason: it is not an independent set.)
    if (s.isDropSegment) continue;
    if (best == null) {
      // The lane's first working set. There is nothing to have exceeded, and
      // celebrating an opening entry is noise — on a new machine every early
      // set would fire.
      best = s.load;
      continue;
    }
    // STRICTLY greater: matching your best is not beating it.
    if (s.load > best) {
      prs.add(s.key);
      best = s.load;
    }
  }
  return prs;
}

/**
 * Would this load be a PR right now? The single-set form, for the moment a set
 * is logged.
 *
 * Bodyweight lanes never produce one: every load ties at 0, and 0 > 0 is false.
 * That falls out of weight-only rather than being special-cased — see DECISIONS.
 */
export function wouldBePr(load: number, priorBest: number | null): boolean {
  return priorBest != null && load > priorBest;
}
