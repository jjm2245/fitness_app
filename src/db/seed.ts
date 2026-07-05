import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./client";
import {
  muscles,
  exercises,
  exerciseMuscles,
  exerciseSubstitutions,
  loadTypeEnum,
  movementPatternEnum,
} from "./schema";

type SeedMuscleRef = { muscle: string; emphasis: number };

type SeedSubstitution = {
  name: string;
  equipment: string[];
  load_type?: string;
  when?: string;
  note?: string;
  in_routine?: boolean;
};

type SeedExercise = {
  id: string;
  name: string;
  day?: string;
  movement_pattern: string;
  primary_muscles: SeedMuscleRef[];
  secondary_muscles: SeedMuscleRef[];
  equipment_required: string[];
  load_type: string;
  portable: boolean;
  affected_structures: string[];
  unilateral: boolean;
  stretch_emphasis: boolean;
  rep_range_default?: string;
  in_current_routine?: boolean;
  conditioning_only?: boolean;
  notes?: string;
  params?: Record<string, unknown>;
  substitutions?: SeedSubstitution[];
};

type SeedFile = {
  muscles: string[];
  movement_patterns: string[];
  exercises: SeedExercise[];
};

const LOAD_TYPES = new Set<string>(loadTypeEnum.enumValues);
const MOVEMENT_PATTERNS = new Set<string>(movementPatternEnum.enumValues);

function assertKnownVocabulary(seed: SeedFile) {
  for (const pattern of seed.movement_patterns) {
    if (!MOVEMENT_PATTERNS.has(pattern)) {
      throw new Error(
        `Seed movement_pattern "${pattern}" is not in the schema enum — update schema.ts first.`
      );
    }
  }
  for (const ex of seed.exercises) {
    if (!LOAD_TYPES.has(ex.load_type)) {
      throw new Error(`Exercise "${ex.id}" has unknown load_type "${ex.load_type}".`);
    }
  }
}

async function loadSeed() {
  const seedPath = join(__dirname, "seed-data", "pf-exercise-seed.json");
  const raw = readFileSync(seedPath, "utf-8");
  const seed: SeedFile = JSON.parse(raw);
  assertKnownVocabulary(seed);

  console.log(`Seeding ${seed.muscles.length} muscles, ${seed.exercises.length} exercises...`);

  for (const muscleId of seed.muscles) {
    await db.insert(muscles).values({ id: muscleId }).onConflictDoNothing();
  }

  for (const ex of seed.exercises) {
    await db
      .insert(exercises)
      .values({
        id: ex.id,
        name: ex.name,
        day: ex.day ?? null,
        movementPattern: ex.movement_pattern as (typeof movementPatternEnum.enumValues)[number],
        equipmentRequired: ex.equipment_required ?? [],
        loadType: ex.load_type as (typeof loadTypeEnum.enumValues)[number],
        portable: ex.portable,
        affectedStructures: ex.affected_structures ?? [],
        unilateral: ex.unilateral ?? false,
        stretchEmphasis: ex.stretch_emphasis ?? false,
        repRangeDefault: ex.rep_range_default ?? null,
        inCurrentRoutine: ex.in_current_routine ?? false,
        conditioningOnly: ex.conditioning_only ?? false,
        notes: ex.notes ?? null,
        params: ex.params ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: exercises.id,
        set: {
          name: ex.name,
          day: ex.day ?? null,
          movementPattern: ex.movement_pattern as (typeof movementPatternEnum.enumValues)[number],
          equipmentRequired: ex.equipment_required ?? [],
          loadType: ex.load_type as (typeof loadTypeEnum.enumValues)[number],
          portable: ex.portable,
          affectedStructures: ex.affected_structures ?? [],
          unilateral: ex.unilateral ?? false,
          stretchEmphasis: ex.stretch_emphasis ?? false,
          repRangeDefault: ex.rep_range_default ?? null,
          inCurrentRoutine: ex.in_current_routine ?? false,
          conditioningOnly: ex.conditioning_only ?? false,
          notes: ex.notes ?? null,
          params: ex.params ?? null,
          updatedAt: new Date(),
        },
      });

    // Fractional emphasis for set-counting (spec §7 / seed emphasis_convention): re-derive
    // this exercise's muscle rows from scratch each run so removed tags don't linger.
    await db.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, ex.id));
    for (const m of ex.primary_muscles ?? []) {
      await db.insert(exerciseMuscles).values({
        exerciseId: ex.id,
        muscle: m.muscle,
        role: "primary",
        emphasis: m.emphasis.toString(),
      });
    }
    for (const m of ex.secondary_muscles ?? []) {
      await db.insert(exerciseMuscles).values({
        exerciseId: ex.id,
        muscle: m.muscle,
        role: "secondary",
        emphasis: m.emphasis.toString(),
      });
    }

    // Substitution candidates: replace wholesale per exercise (see DECISIONS.md —
    // most reference exercises by name only, not yet promoted to their own nodes).
    await db.delete(exerciseSubstitutions).where(eq(exerciseSubstitutions.exerciseId, ex.id));
    for (const sub of ex.substitutions ?? []) {
      await db.insert(exerciseSubstitutions).values({
        exerciseId: ex.id,
        name: sub.name,
        equipment: sub.equipment ?? [],
        loadType: (sub.load_type as (typeof loadTypeEnum.enumValues)[number]) ?? null,
        whenContext: sub.when ?? null,
        note: sub.note ?? null,
        inRoutine: sub.in_routine ?? false,
      });
    }
  }

  console.log("Seed complete.");
}

loadSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
