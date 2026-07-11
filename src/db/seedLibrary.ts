import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { exercises, exerciseMuscles, loadTypeEnum } from "./schema";

// Ingests the free-exercise-db (github.com/yuhonas/free-exercise-db, Unlicense /
// public domain) into the exercise graph as source="library", pre-tagged with
// muscles so volume math works. Library rows carry NO movement_pattern (the
// dataset lacks our taxonomy), so they simply don't participate in substitution
// — an honest limitation, documented in DECISIONS.md. Also applies the 16
// high-confidence canonical pairings to the curated core, additively (never
// overwriting the hand tags). Idempotent: safe to re-run.

interface LibraryExercise {
  id: string;
  name: string;
  category: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
}

// Library muscle vocabulary -> our finer-grained slugs. "neck" has no
// counterpart in our set and is dropped (nothing to attribute).
const MUSCLE_MAP: Record<string, string | null> = {
  abdominals: "rectus_abdominis",
  abductors: "gluteus_medius_minimus",
  adductors: "adductors",
  biceps: "biceps",
  calves: "calves",
  chest: "chest",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  lats: "lats",
  "lower back": "spinal_erectors",
  "middle back": "rhomboids",
  neck: null,
  quadriceps: "quadriceps",
  shoulders: "anterior_deltoid",
  traps: "upper_traps",
  triceps: "triceps",
};

type LoadType = (typeof loadTypeEnum.enumValues)[number];
const EQUIPMENT_MAP: Record<string, { loadType: LoadType; portable: boolean }> = {
  "body only": { loadType: "bodyweight", portable: true },
  dumbbell: { loadType: "free_weight", portable: true },
  barbell: { loadType: "free_weight", portable: true },
  "e-z curl bar": { loadType: "free_weight", portable: true },
  kettlebells: { loadType: "free_weight", portable: true },
  "medicine ball": { loadType: "free_weight", portable: true },
  cable: { loadType: "cable", portable: false },
  machine: { loadType: "machine_selectorized", portable: false },
  bands: { loadType: "bodyweight", portable: true },
  "exercise ball": { loadType: "bodyweight", portable: true },
  "foam roll": { loadType: "bodyweight", portable: true },
  other: { loadType: "bodyweight", portable: true },
};

// The 16 high-confidence pairings the user approved. curated id -> canonical
// library name (resolved to a library id at ingest time).
const PAIRINGS: Record<string, string> = {
  machine_leg_extension: "Leg Extensions",
  hip_adductor_machine: "Thigh Adductor",
  hip_abductor_machine: "Thigh Abductor",
  reverse_pec_dec: "Reverse Machine Flyes",
  cable_tricep_pushdown: "Triceps Pushdown - V-Bar Attachment",
  cable_overhead_tricep_ext: "Cable Rope Overhead Triceps Extension",
  machine_preacher_curl: "Machine Preacher Curls",
  cable_hammer_curl: "Cable Hammer Curls - Rope Attachment",
  bodyweight_pullup: "Pullups",
  back_extension: "Hyperextensions (Back Extensions)",
  hanging_leg_raise: "Hanging Leg Raise",
  machine_ab_crunch: "Ab Crunch Machine",
  shoulder_press: "Dumbbell Shoulder Press",
  smith_squat: "Smith Machine Squat",
  deadlift: "Romanian Deadlift",
  russian_twist_heel_touch: "Russian Twist",
};

function libExerciseId(libId: string): string {
  return `lib_${libId}`;
}

async function run() {
  const libPath = join(__dirname, "seed-data", "free-exercise-db.json");
  const lib: LibraryExercise[] = JSON.parse(readFileSync(libPath, "utf-8"));
  console.log(`Ingesting ${lib.length} library exercises...`);

  const byName = new Map(lib.map((e) => [e.name, e]));

  for (const e of lib) {
    const equip = EQUIPMENT_MAP[e.equipment ?? "other"] ?? { loadType: "bodyweight" as LoadType, portable: true };
    const id = libExerciseId(e.id);
    const conditioningOnly = e.category === "cardio";

    await db
      .insert(exercises)
      .values({
        id,
        name: e.name,
        movementPattern: null,
        equipmentRequired: e.equipment ? [e.equipment] : [],
        loadType: equip.loadType,
        portable: equip.portable,
        conditioningOnly,
        source: "library",
        libraryId: e.id,
        canonicalName: e.name,
        untagged: false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: exercises.id,
        set: {
          name: e.name,
          loadType: equip.loadType,
          portable: equip.portable,
          conditioningOnly,
          source: "library",
          libraryId: e.id,
          canonicalName: e.name,
          updatedAt: new Date(),
        },
      });

    // Re-derive muscle rows from the library tags (primary 1.0, secondary 0.5).
    await db.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, id));
    const seen = new Set<string>();
    for (const m of e.primaryMuscles) {
      const slug = MUSCLE_MAP[m];
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      await db.insert(exerciseMuscles).values({ exerciseId: id, muscle: slug, role: "primary", emphasis: "1.0" });
    }
    for (const m of e.secondaryMuscles) {
      const slug = MUSCLE_MAP[m];
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      await db.insert(exerciseMuscles).values({ exerciseId: id, muscle: slug, role: "secondary", emphasis: "0.5" });
    }
  }

  // Apply the approved pairings additively — set canonical_name + library_id on
  // the curated exercise, never touching its existing tags.
  let paired = 0;
  for (const [curatedId, canonicalName] of Object.entries(PAIRINGS)) {
    const libEx = byName.get(canonicalName);
    if (!libEx) {
      console.warn(`  ! pairing skipped, canonical not found: ${canonicalName}`);
      continue;
    }
    const res = await db
      .update(exercises)
      .set({ canonicalName, libraryId: libEx.id, updatedAt: new Date() })
      .where(eq(exercises.id, curatedId))
      .returning({ id: exercises.id });
    if (res.length) paired += 1;
  }

  console.log(`Library ingest complete. Applied ${paired} pairings.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
