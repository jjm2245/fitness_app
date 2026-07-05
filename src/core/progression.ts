// Spec §7: progression is driven by volume-load (load x reps), never estimated-1RM
// (unreliable in 12-20 rep hypertrophy ranges and on cable/Smith). Everything here
// operates on a single (exercise_id, machine_id) lane at a time — see
// machineTracking.ts for grouping raw set logs into those lanes.

export interface SessionSummary {
  date: string;
  workingSets: Array<{ load: number; reps: number; rir: number | null }>;
}

export type ProgressionSignal =
  | { type: "insufficient_data" }
  | { type: "increase_load"; reason: string; suggestedLoad?: number }
  | { type: "progressing"; reason: string }
  | { type: "true_stall"; reason: string }
  | { type: "regression"; reason: string }
  | { type: "hold"; reason: string };

export interface ProgressionContext {
  repRangeMax: number;
  targetRir: number;
  /** Sessions of flat load+reps at target effort before calling a true stall. Spec
   * doesn't pin an exact N; 3 is a documented default (see DECISIONS.md). */
  stallSessionThreshold?: number;
  /** When provided, an increase_load signal includes a concrete suggestedLoad
   * (current top-set load + the smallest step for this load type). */
  loadType?: string;
}

// Rough default load-increment-per-side-or-total assumptions per load type, since
// the app doesn't yet track actual per-machine plate/pin increments (spec §9's
// "Machine" model has room for this later). Documented in DECISIONS.md.
const DEFAULT_LOAD_INCREMENTS: Record<string, number> = {
  free_weight: 5,
  bodyweight: 5,
  smith: 10,
  cable: 5,
  machine_selectorized: 10,
  plate_loaded: 10,
};

export function defaultLoadIncrement(loadType: string): number {
  return DEFAULT_LOAD_INCREMENTS[loadType] ?? 5;
}

export function suggestNextLoad(currentLoad: number, loadType: string): number {
  return currentLoad + defaultLoadIncrement(loadType);
}

export function sessionVolumeLoad(session: SessionSummary): number {
  return session.workingSets.reduce((sum, s) => sum + s.load * s.reps, 0);
}

/** The heaviest working set in a session, used as the representative set for
 * load/rep-range comparisons (spec's "top of rep range" language is per-set). */
export function topSet(session: SessionSummary) {
  return session.workingSets.reduce((best, s) => (s.load > best.load ? s : best));
}

export function sessionsFromOldestToNewest(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function classifyProgression(
  rawSessions: SessionSummary[],
  context: ProgressionContext
): ProgressionSignal {
  const stallThreshold = context.stallSessionThreshold ?? 3;
  const sessions = sessionsFromOldestToNewest(rawSessions).filter(
    (s) => s.workingSets.length > 0
  );

  if (sessions.length < 2) {
    return { type: "insufficient_data" };
  }

  const latest = sessions[sessions.length - 1];
  const previous = sessions[sessions.length - 2];
  const latestTop = topSet(latest);
  const previousTop = topSet(previous);

  const latestAtOrBelowTargetRir = latest.workingSets.every(
    (s) => (s.rir ?? context.targetRir) <= context.targetRir
  );
  const latestAtRepCeiling = latest.workingSets.every((s) => s.reps >= context.repRangeMax);

  if (latestAtRepCeiling && latestAtOrBelowTargetRir) {
    return {
      type: "increase_load",
      reason: "Hit top of rep range at or below target RIR — add the smallest load step and reset reps.",
      suggestedLoad: context.loadType
        ? suggestNextLoad(latestTop.load, context.loadType)
        : undefined,
    };
  }

  if (latestTop.load === previousTop.load && latestTop.reps > previousTop.reps) {
    return { type: "progressing", reason: "Reps rising at the same load." };
  }

  // Regression: volume-load trending down across the last 2+ sessions.
  if (sessions.length >= 3) {
    const lastThree = sessions.slice(-3).map(sessionVolumeLoad);
    if (lastThree[0] > lastThree[1] && lastThree[1] > lastThree[2]) {
      return {
        type: "regression",
        reason: "Volume-load has dropped for 2+ consecutive sessions — likely fatigue, consider a deload.",
      };
    }
  }

  // True stall: load AND reps flat at target effort for N consecutive sessions.
  const window = sessions.slice(-stallThreshold);
  if (window.length === stallThreshold) {
    const tops = window.map(topSet);
    const flatLoad = tops.every((s) => s.load === tops[0].load);
    const flatReps = tops.every((s) => s.reps === tops[0].reps);
    const atTargetEffort = tops.every((s) => (s.rir ?? context.targetRir) <= context.targetRir);

    if (flatLoad && flatReps && atTargetEffort) {
      return {
        type: "true_stall",
        reason: `Load and reps flat at target effort for ${stallThreshold} sessions.`,
      };
    }
  }

  return { type: "hold", reason: "No clear progression, stall, or regression signal yet." };
}
