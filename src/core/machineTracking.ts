import type { SetLogInput } from "./types";
import { classifyProgression, type ProgressionContext, type ProgressionSignal, type SessionSummary } from "./progression";

// Spec §9: a stack number isn't a universal unit of resistance. Machine/Smith/cable
// loads are context-bound — track progression per machine_id and re-baseline on
// change instead of flagging a false stall. Free weight/bodyweight sets (machineId
// null) are the portable anchors and don't need this re-baselining.

export function laneKey(exerciseId: string, machineId: string | null): string {
  return `${exerciseId}::${machineId ?? "portable"}`;
}

export function groupSetsByLane(sets: SetLogInput[]): Record<string, SetLogInput[]> {
  const groups: Record<string, SetLogInput[]> = {};
  for (const set of sets) {
    const key = laneKey(set.exerciseId, set.machineId);
    (groups[key] ??= []).push(set);
  }
  return groups;
}

export function toSessionSummaries(sets: SetLogInput[]): SessionSummary[] {
  const byDate = new Map<string, SetLogInput[]>();
  for (const set of sets) {
    if (set.setType !== "working") continue;
    const list = byDate.get(set.date) ?? [];
    list.push(set);
    byDate.set(set.date, list);
  }
  return Array.from(byDate.entries()).map(([date, dateSets]) => ({
    date,
    workingSets: dateSets.map((s) => ({ load: s.load, reps: s.reps, rir: s.rir ?? null })),
  }));
}

export type MachineProgressionResult =
  | { status: "new_machine_baseline"; reason: string }
  | { status: "resolved"; signal: ProgressionSignal };

/**
 * Resolves the progression signal for one exercise on one machine (or the portable
 * lane when machineId is null), detecting a machine change first so a switch to a
 * new machine re-baselines rather than reading as a stall or regression.
 */
export function resolveProgressionSignal(
  allSetsForExercise: SetLogInput[],
  machineId: string | null,
  context: ProgressionContext
): MachineProgressionResult {
  const currentLaneSets = allSetsForExercise.filter((s) => s.machineId === machineId);
  const currentLaneSessions = toSessionSummaries(currentLaneSets);

  if (machineId !== null && currentLaneSessions.length < 2) {
    const hasHistoryOnOtherMachine = allSetsForExercise.some(
      (s) => s.machineId !== null && s.machineId !== machineId
    );
    if (hasHistoryOnOtherMachine) {
      return {
        status: "new_machine_baseline",
        reason: "No history on this machine yet after a machine change — re-baseline instead of flagging a stall.",
      };
    }
  }

  return { status: "resolved", signal: classifyProgression(currentLaneSessions, context) };
}
