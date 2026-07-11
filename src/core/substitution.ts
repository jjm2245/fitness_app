import type { ExerciseTags } from "./types";

// Spec §8: deterministic candidate filtering. The LLM's final 1-2 pick + explanation
// is out of scope for this session — we return a ranked candidate list only.

function muscleSet(exercise: Pick<ExerciseTags, "muscles">): Set<string> {
  return new Set(exercise.muscles.map((m) => m.muscle));
}

function overlapsMuscles(a: Pick<ExerciseTags, "muscles">, b: Pick<ExerciseTags, "muscles">): boolean {
  const bSet = muscleSet(b);
  return a.muscles.some((m) => bSet.has(m.muscle));
}

function equipmentSubsetOf(required: string[], available: string[]): boolean {
  const availableSet = new Set(available);
  return required.every((eq) => availableSet.has(eq));
}

function hasContraindication(candidate: ExerciseTags, activeInjuryStructures: string[]): boolean {
  if (activeInjuryStructures.length === 0) return false;
  const activeSet = new Set(activeInjuryStructures);
  return candidate.affectedStructures.some((s) => activeSet.has(s));
}

export interface SubstitutionQuery {
  original: ExerciseTags;
  pool: ExerciseTags[];
  availableEquipment: string[];
  activeInjuryStructures: string[];
}

export function findSubstitutionCandidates(query: SubstitutionQuery): ExerciseTags[] {
  const { original, pool, availableEquipment, activeInjuryStructures } = query;

  // A null movement pattern is unmatchable (an untagged/library item can't be
  // placed by pattern) — never treat two nulls as a match.
  if (original.movementPattern === null) return [];

  return pool.filter((candidate) => {
    if (candidate.id === original.id) return false;
    if (candidate.movementPattern === null) return false;
    if (candidate.movementPattern !== original.movementPattern) return false;
    if (!overlapsMuscles(candidate, original)) return false;
    if (!equipmentSubsetOf(candidate.equipmentRequired, availableEquipment)) return false;
    if (hasContraindication(candidate, activeInjuryStructures)) return false;
    return true;
  });
}

/** Cosine similarity over muscle->emphasis vectors — how closely a candidate
 * reproduces the original's muscle emphasis profile. */
function muscleEmphasisSimilarity(a: ExerciseTags, b: ExerciseTags): number {
  const aMap = new Map(a.muscles.map((m) => [m.muscle, m.emphasis]));
  const bMap = new Map(b.muscles.map((m) => [m.muscle, m.emphasis]));
  const allMuscles = new Set([...aMap.keys(), ...bMap.keys()]);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const muscle of allMuscles) {
    const av = aMap.get(muscle) ?? 0;
    const bv = bMap.get(muscle) ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function skillMatchScore(a: ExerciseTags, b: ExerciseTags): number {
  if (!a.skillLevel || !b.skillLevel) return 0; // no data — neutral, no penalty
  return a.skillLevel === b.skillLevel ? 1 : 0;
}

export function rankSubstitutionCandidates(
  original: ExerciseTags,
  candidates: ExerciseTags[]
): Array<{ exercise: ExerciseTags; score: number }> {
  return candidates
    .map((exercise) => ({
      exercise,
      score: muscleEmphasisSimilarity(original, exercise) + skillMatchScore(original, exercise),
    }))
    .sort((a, b) => b.score - a.score);
}
