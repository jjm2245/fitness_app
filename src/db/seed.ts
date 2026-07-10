import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { muscles, exercises, exerciseMuscles, exerciseSubstitutions, loadTypeEnum, movementPatternEnum } from "./schema";
import {
  listPrograms,
  seedProgramFromRoutine,
  getOrCreateBlockLibrary,
  listBlocks,
  addDay,
  addExerciseToDay,
  type SeedRoutineDay,
} from "@/lib/programs";

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

  await seedInitialProgramIfNone(seed);
  await seedStarterBlocksIfNone(seed);

  console.log("Seed complete.");
}

const INITIAL_SPLIT_TYPE = "ppl_pf_current_routine";

// Runs only once: if any program already exists — including one the user has
// since edited in the program editor — this is a no-op. Re-running `db:seed`
// (e.g. after editing the exercise graph) must never wipe a user-edited
// program. Uses seedProgramFromRoutine, the exact same primitives the editor
// API calls — there is no separate "default program" policy baked in here,
// only a one-time convenience so logging has something to log against before
// the editor has been used. See DECISIONS.md.
async function seedInitialProgramIfNone(seed: SeedFile) {
  const existing = await listPrograms();
  if (existing.length > 0) {
    console.log(`Skipping program seed — ${existing.length} program(s) already exist.`);
    return;
  }

  const routineExercises = seed.exercises.filter((ex) => ex.in_current_routine);
  const days: SeedRoutineDay[] = [];
  const dayIndex = new Map<string, number>();

  for (const ex of routineExercises) {
    const dayName = ex.day ?? "unassigned";
    let idx = dayIndex.get(dayName);
    if (idx === undefined) {
      idx = days.length;
      dayIndex.set(dayName, idx);
      days.push({ name: dayName, exercises: [] });
    }
    days[idx].exercises.push({ exerciseId: ex.id, conditioningOnly: ex.conditioning_only ?? false });
  }

  const program = await seedProgramFromRoutine(INITIAL_SPLIT_TYPE, days);
  console.log(
    `Seeded initial program "${program.splitType}" with ${routineExercises.length} program-exercise rows across ${days.length} days.`
  );
}

// Starter reusable blocks so the one-tap "attach abs/cardio at the end" flow
// works out of the box. Non-destructive: only seeds if the block library is
// empty. Built from the seed's abs/cardio day exercises via the same
// addDay/addExerciseToDay primitives the /blocks editor uses.
async function seedStarterBlocksIfNone(seed: SeedFile) {
  const lib = await getOrCreateBlockLibrary();
  const existingBlocks = await listBlocks();
  if (existingBlocks.length > 0) {
    console.log(`Skipping block seed — ${existingBlocks.length} block(s) already exist.`);
    return;
  }

  const blockDayNames: Record<string, string> = { abs: "Abs", cardio: "Cardio" };
  let created = 0;
  for (const [seedDay, blockName] of Object.entries(blockDayNames)) {
    const exs = seed.exercises.filter((ex) => ex.in_current_routine && ex.day === seedDay);
    if (exs.length === 0) continue;
    const day = await addDay(lib.id, blockName);
    for (const ex of exs) {
      await addExerciseToDay(
        day.id,
        ex.id,
        ex.conditioning_only ? { targetSets: 1, repRange: null, rirTarget: null } : {}
      );
    }
    created += 1;
  }
  console.log(`Seeded ${created} starter block(s) into the block library.`);
}

loadSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
