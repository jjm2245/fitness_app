import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "./client";
import { exercises, exerciseMuscles, setLogs, cardioLogs, programExercises, sessionExercises, loadTypeEnum } from "./schema";

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

// The approved seed→library mapping (round-3, user-validated exactly). A merge
// makes the curated exercise the single entry: it takes the canonical library
// name as its display name (a few keep a more precise `display` the user
// prefers) and keeps ALL its curated tags (movement pattern, muscle emphasis,
// safety flags, substitutions). The library twin is then removed so it no
// longer shows as a separate search result — replacing the earlier "hide the
// twin" half-fix. `canonical` is validated to exist in the library at run time.
interface Merge {
  canonical: string; // exact library name — the reference + default display
  display?: string; // override when the user's precise name beats the library's
}
const MERGES: Record<string, Merge> = {
  // Legs + shoulders
  machine_leg_extension: { canonical: "Leg Extensions" },
  hip_abductor_machine: { canonical: "Thigh Abductor" },
  hip_adductor_machine: { canonical: "Thigh Adductor" },
  reverse_pec_dec: { canonical: "Reverse Machine Flyes" },
  smith_squat: { canonical: "Smith Machine Squat" },
  shoulder_press: { canonical: "Machine Shoulder (Military) Press" },
  machine_leg_curl: { canonical: "Seated Leg Curl" },
  db_goblet_squat: { canonical: "Goblet Squat" },
  lateral_raise: { canonical: "Side Lateral Raise" },
  shoulder_shrug: { canonical: "Dumbbell Shrug" },
  weighted_calf_raise: { canonical: "Standing Calf Raises" },
  cable_lateral_raise: { canonical: "Standing Low-Pulley Deltoid Raise" },
  barbell_squat: { canonical: "Barbell Squat" },
  hack_squat: { canonical: "Hack Squat" },
  face_pull: { canonical: "Face Pull" },
  // Chest + triceps
  cable_tricep_pushdown: { canonical: "Triceps Pushdown - V-Bar Attachment" },
  cable_overhead_tricep_ext: { canonical: "Triceps Overhead Extension with Rope" },
  machine_chest_press: { canonical: "Machine Bench Press" },
  incline_bench_press: { canonical: "Leverage Incline Chest Press" },
  pec_dec: { canonical: "Butterfly" },
  bodyweight_dips: { canonical: "Dips - Triceps Version" },
  skull_crusher: { canonical: "EZ-Bar Skullcrusher" },
  // Back + biceps
  bodyweight_pullup: { canonical: "Pullups" },
  cable_hammer_curl: { canonical: "Cable Hammer Curls - Rope Attachment" },
  machine_preacher_curl: { canonical: "Machine Preacher Curls" },
  deadlift: { canonical: "Stiff-Legged Dumbbell Deadlift" },
  smith_rdl: { canonical: "Smith Machine Stiff-Legged Deadlift" },
  cable_lat_pulldown: { canonical: "Wide-Grip Lat Pulldown" },
  cable_close_grip_row: { canonical: "Seated Cable Rows" },
  cable_bicep_curl: { canonical: "Standing Biceps Cable Curl" },
  stiff_legged_barbell_deadlift: { canonical: "Stiff-Legged Barbell Deadlift" },
  // Abs + cardio
  hanging_leg_raise: { canonical: "Knee/Hip Raise On Parallel Bars", display: "Captain's Chair Straight-Leg Raise" },
  machine_ab_crunch: { canonical: "Ab Crunch Machine" },
  russian_twist_heel_touch: { canonical: "Russian Twist" },
  heel_touches: { canonical: "Alternate Heel Touchers" },
  weighted_toe_touch: { canonical: "Toe Touchers", display: "Toe Touches" },
  full_extension_crunch: { canonical: "Cocoons", display: "Full-Extension Double Crunch — Hands Behind Head" },
  stair_machine: { canonical: "Stairmaster" },
  treadmill_incline_walk: { canonical: "Walking, Treadmill" },
};

// Curated exercises the user chose to keep custom (no acceptable library match):
// keep their precise name, unpair (drop any earlier canonical link), stay fully
// tagged. back_extension was previously mis-paired to "Hyperextensions" (a
// different movement) — this unpairs and renames it.
const CUSTOM_RENAMES: Record<string, string> = {
  back_extension: "Seated Back Extension Machine",
};

function libExerciseId(libId: string): string {
  return `lib_${libId}`;
}

async function run() {
  const libPath = join(__dirname, "seed-data", "free-exercise-db.json");
  const lib: LibraryExercise[] = JSON.parse(readFileSync(libPath, "utf-8"));
  console.log(`Ingesting ${lib.length} library exercises...`);

  const byName = new Map(lib.map((e) => [e.name, e]));

  // Names that merge into a curated exercise. Their library twins are never
  // ingested (and any left over from a prior run are removed first), so the
  // merged curated row is the only search hit for that name.
  const canonicalTargets = new Set(Object.values(MERGES).map((m) => m.canonical));
  for (const name of canonicalTargets) {
    if (!byName.has(name)) throw new Error(`Merge canonical not found in library: "${name}"`);
  }
  await removeTwins(canonicalTargets);

  for (const e of lib) {
    if (canonicalTargets.has(e.name)) continue; // twin merged into a curated row
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
        // Library rows carry no movement pattern, so they read as "untagged"
        // (not substitutable) until the movement-pattern-on-add flow graduates
        // one. This keeps `untagged` a reliable proxy for "no movement pattern".
        untagged: true,
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
          // Don't clobber a pattern a user has since assigned via the add flow.
          untagged: sql`case when ${exercises.movementPattern} is null then true else false end`,
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

  // Apply the merges: the curated row takes the canonical name as its display
  // (or a preferred override) and records the library reference, never touching
  // its hand tags. The twin was already excluded above.
  let merged = 0;
  for (const [curatedId, { canonical, display }] of Object.entries(MERGES)) {
    const libEx = byName.get(canonical)!;
    const res = await db
      .update(exercises)
      .set({
        name: display ?? canonical,
        canonicalName: canonical,
        libraryId: libEx.id,
        untagged: false,
        updatedAt: new Date(),
      })
      .where(eq(exercises.id, curatedId))
      .returning({ id: exercises.id });
    if (res.length) merged += 1;
    else console.warn(`  ! merge target curated exercise not found: ${curatedId} (run db:seed first)`);
  }

  // Keep-custom renames: unpair + rename, stay fully tagged.
  let renamed = 0;
  for (const [curatedId, name] of Object.entries(CUSTOM_RENAMES)) {
    const res = await db
      .update(exercises)
      .set({ name, canonicalName: null, libraryId: null, updatedAt: new Date() })
      .where(eq(exercises.id, curatedId))
      .returning({ id: exercises.id });
    if (res.length) renamed += 1;
  }

  console.log(`Library ingest complete. Merged ${merged} pairings, ${renamed} custom renames.`);
}

// Delete library twins by name (and their muscle rows via cascade). Guarded:
// a twin referenced by any log or program row is left in place with a warning
// rather than silently orphaning history — merges are for unreferenced twins.
async function removeTwins(names: Set<string>) {
  if (names.size === 0) return;
  const twins = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.source, "library"), inArray(exercises.name, [...names])));
  for (const { id } of twins) {
    const [s] = await db.select({ id: setLogs.id }).from(setLogs).where(eq(setLogs.exerciseId, id)).limit(1);
    const [c] = await db.select({ id: cardioLogs.id }).from(cardioLogs).where(eq(cardioLogs.exerciseId, id)).limit(1);
    const [p] = await db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.exerciseId, id)).limit(1);
    // session_exercises.exercise_id is a plain FK (no cascade/set null), so a
    // twin referenced by a performed occurrence would hard-fail the delete —
    // guard it the same way (leave in place with a warning, never orphan).
    const [se] = await db.select({ id: sessionExercises.id }).from(sessionExercises).where(eq(sessionExercises.exerciseId, id)).limit(1);
    if (s || c || p || se) {
      console.warn(`  ! twin ${id} is referenced (log/program) — left in place, not merged away`);
      continue;
    }
    await db.delete(exercises).where(eq(exercises.id, id));
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
