import type { ExerciseTags, SetLogInput } from "./types";

// Spec §7 set-counting rule + seed emphasis_convention: a working set counts its
// stored emphasis (1.0 primary / 0.5 meaningful secondary / 0.3 minor secondary)
// toward that muscle; warm-ups count 0. See DECISIONS.md for why we use the
// seed's 3-tier emphasis instead of the spec's flatter "primary 1.0, secondary 0.5".
export function countedSetContribution(
  set: SetLogInput,
  exerciseMuscles: Pick<ExerciseTags, "muscles">
): Record<string, number> {
  if (set.setType !== "working") return {};

  const contribution: Record<string, number> = {};
  for (const m of exerciseMuscles.muscles) {
    contribution[m.muscle] = (contribution[m.muscle] ?? 0) + m.emphasis;
  }
  return contribution;
}

export function volumeByMuscle(
  sets: SetLogInput[],
  exercisesById: Record<string, Pick<ExerciseTags, "muscles">>
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const set of sets) {
    const exercise = exercisesById[set.exerciseId];
    if (!exercise) continue; // unknown exercise id — nothing to attribute

    const contribution = countedSetContribution(set, exercise);
    for (const [muscle, value] of Object.entries(contribution)) {
      totals[muscle] = (totals[muscle] ?? 0) + value;
    }
  }

  return totals;
}

export function volumeByMuscleInRange(
  sets: SetLogInput[],
  exercisesById: Record<string, Pick<ExerciseTags, "muscles">>,
  startDate: string,
  endDate: string
): Record<string, number> {
  const inRange = sets.filter((s) => s.date >= startDate && s.date <= endDate);
  return volumeByMuscle(inRange, exercisesById);
}

// Spec §7: floor ~8-10 (novice start), productive ~10-20, push higher only when
// stalled and recovery is intact. These are novice defaults per the user's profile.
export const VOLUME_LANDMARKS = {
  floor: 8,
  productiveLow: 10,
  productiveHigh: 20,
} as const;

export type VolumeZone = "below_floor" | "productive" | "high";

export function classifyVolumeZone(weeklySets: number): VolumeZone {
  if (weeklySets < VOLUME_LANDMARKS.floor) return "below_floor";
  if (weeklySets <= VOLUME_LANDMARKS.productiveHigh) return "productive";
  return "high";
}
