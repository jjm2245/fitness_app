// G3 adapter — the index's trend words, from the SHIPPED verdict engine.
//
// This is a THIN adapter, and the thinness is the contract:
// - The verdict comes from `resolveProgressionSignal` (src/core/machineTracking
//   → classifyProgression), the exact function Train's card calls through
//   /api/progression.
// - The context is that route's OWN defaults (repRangeMax 12, targetRir 2,
//   stallSessionThreshold 3) — the same numbers an untargeted occurrence gets
//   in Train. No threshold is forked.
// - The WORDS are the engine's signal identifiers with underscores exchanged
//   for spaces — `increase load`, `progressing`, `true stall`, `regression`,
//   `hold`, `insufficient data`, `new machine baseline`. Nothing is invented;
//   there is no local word list to drift (the checklist greps for one).
// - The per-exercise question is answered per-LANE, on the exercise's
//   most-recently-used lane — the engine is lane-scoped on purpose (loads
//   aren't comparable across machines), so "this exercise's trend" means "the
//   machine you currently use for it".
//
// The engine groups a lane's sessions BY DATE internally (core semantics,
// same as Train). Stats screens group by workout_logs.id; the trend WORD
// inherits the engine's own grouping because the word must match what Train
// would say, not what Stats renders.

import { resolveProgressionSignal } from "@/core/machineTracking";
import type { SetLogInput } from "@/core/types";

/** /api/progression's own defaults — the adapter forks nothing. */
const ROUTE_DEFAULTS = { repRangeMax: 12, targetRir: 2, stallSessionThreshold: 3 };

export type TrendTier = "positive" | "negative" | "neutral";

export interface Trend {
  /** The engine's identifier, verbatim (e.g. "increase_load"). */
  type: string;
  /** The identifier with underscores as spaces — the rendered word. */
  word: string;
  tier: TrendTier;
}

const POSITIVE = new Set(["increase_load", "progressing"]);
const NEGATIVE = new Set(["regression", "true_stall"]);

export function laneTrend(allSetsForExercise: SetLogInput[], lane: string | null): Trend {
  const result = resolveProgressionSignal(allSetsForExercise, lane, ROUTE_DEFAULTS);
  const type = result.status === "new_machine_baseline" ? "new_machine_baseline" : result.signal.type;
  return {
    type,
    word: type.replace(/_/g, " "),
    tier: POSITIVE.has(type) ? "positive" : NEGATIVE.has(type) ? "negative" : "neutral",
  };
}
