// Shared types for the deterministic core (spec §7-9). Deliberately DB-agnostic —
// these modules take plain data in and return plain data out so they're cheap to
// unit-test and easy to call from API routes without dragging in Drizzle types.

export type SetType = "warmup" | "working";

export type MuscleRole = "primary" | "secondary";

export interface MuscleEmphasis {
  muscle: string;
  role: MuscleRole;
  emphasis: number; // 1.0 primary, 0.5 meaningful secondary, 0.3 minor secondary (seed convention)
}

export interface ExerciseTags {
  id: string;
  // Null when an exercise has no movement pattern (e.g. an untagged item, or a
  // library entry without our taxonomy). A null pattern never matches in
  // substitution — the engine stays general and simply can't place it.
  movementPattern: string | null;
  muscles: MuscleEmphasis[];
  equipmentRequired: string[];
  affectedStructures: string[];
  skillLevel?: string | null;
}

export interface SetLogInput {
  exerciseId: string;
  machineId: string | null;
  date: string; // ISO date, session identity groups by this
  setType: SetType;
  load: number;
  reps: number;
  rir?: number | null;
}
