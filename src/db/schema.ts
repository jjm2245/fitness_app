import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums (fixed vocabularies pulled from the spec + seed data)
// ---------------------------------------------------------------------------

export const goalModeEnum = pgEnum("goal_mode", ["recomp", "lean_bulk", "cut"]);

export const trainingAgeEnum = pgEnum("training_age", [
  "novice",
  "intermediate",
  "advanced",
]);

export const loadTypeEnum = pgEnum("load_type", [
  "free_weight",
  "bodyweight",
  "smith",
  "cable",
  "machine_selectorized",
  "plate_loaded",
]);

export const movementPatternEnum = pgEnum("movement_pattern", [
  "squat",
  "hinge",
  "knee_extension",
  "knee_flexion",
  "hip_adduction",
  "hip_abduction",
  "plantarflexion",
  "horizontal_push",
  "incline_push",
  "vertical_push",
  "dip",
  "horizontal_pull",
  "vertical_pull",
  "shrug",
  "lateral_raise",
  "rear_delt_fly",
  "chest_fly",
  "elbow_flexion",
  "elbow_extension",
  "spinal_extension",
  "trunk_flexion",
  "trunk_rotation",
  "conditioning",
]);

export const muscleRoleEnum = pgEnum("muscle_role", ["primary", "secondary"]);

export const setTypeEnum = pgEnum("set_type", ["warmup", "working"]);

// Proximity-to-failure as a one-tap tag (replaces asking for an RIR number).
// The adapter layer maps this to a normalized numeric the deterministic core
// consumes — the core never sees this label. See DECISIONS.md + coreAdapters.
export const effortEnum = pgEnum("effort", ["more_in_me", "near_failure", "to_failure"]);

// Where an exercise came from — for provenance badges and to distinguish the
// hand-tagged curated core from the broad open library and free-typed customs.
export const exerciseSourceEnum = pgEnum("exercise_source", ["curated", "library", "custom"]);

// ---------------------------------------------------------------------------
// Profile (singleton — single-user app, one row)
// ---------------------------------------------------------------------------

export const profile = pgTable("profile", {
  id: serial("id").primaryKey(),
  dob: date("dob").notNull(),
  sex: text("sex").notNull(),
  heightIn: numeric("height_in").notNull(),
  goalMode: goalModeEnum("goal_mode").notNull().default("recomp"),
  trainingAge: trainingAgeEnum("training_age").notNull().default("novice"),
  availableDays: integer("available_days").notNull().default(6),
  // Per-item toggles on top of the PF default kit (§8a), e.g. { half_rack: true, dumbbell_max_lb: 60 }
  equipmentProfile: jsonb("equipment_profile").notNull().default({}),
  activitySeed: text("activity_seed").notNull().default("sedentary"),
  proteinTargetG: numeric("protein_target_g"),
  preferences: jsonb("preferences").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Auth — brute-force protection for the single shared passcode (spec §14,
// now required since the app is public). Failed attempts only; rows are
// pruned opportunistically by the login route. See DECISIONS.md.
// ---------------------------------------------------------------------------

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull(),
  // withTimezone: true is required here — this column is compared against
  // JS Date objects computed in application code (the rate-limit window).
  // A plain `timestamp` column stores/compares using the DB server's local
  // timezone, which silently breaks that comparison whenever the server
  // isn't UTC (discovered live: ~4h offset against America/New_York). See
  // DECISIONS.md — other timestamp columns in this schema are informational
  // only and never compared against a JS Date, so they're left as-is.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Exercise + Machine graph (the substitution asset — spec §6, §8, §9)
// ---------------------------------------------------------------------------

export const muscles = pgTable("muscles", {
  id: text("id").primaryKey(), // slug, e.g. "quadriceps"
});

export const exercises = pgTable("exercises", {
  id: text("id").primaryKey(), // slug from seed, e.g. "machine_leg_extension"
  name: text("name").notNull(),
  day: text("day"), // routine day tag from seed: legs_shoulders | chest_triceps | back_biceps | abs | cardio
  // Nullable now: library exercises don't carry our movement_pattern taxonomy,
  // and free-typed customs are untagged until the user (or, later, the LLM)
  // tags them. A null pattern simply never matches in substitution.
  movementPattern: movementPatternEnum("movement_pattern"),
  equipmentRequired: text("equipment_required").array().notNull().default([]),
  loadType: loadTypeEnum("load_type").notNull(),
  portable: boolean("portable").notNull(),
  affectedStructures: text("affected_structures").array().notNull().default([]),
  unilateral: boolean("unilateral").notNull().default(false),
  stabilityDemand: text("stability_demand"),
  skillLevel: text("skill_level"),
  stretchEmphasis: boolean("stretch_emphasis").notNull().default(false),
  repRangeDefault: text("rep_range_default"),
  inCurrentRoutine: boolean("in_current_routine").notNull().default(false),
  conditioningOnly: boolean("conditioning_only").notNull().default(false),
  // Provenance + library pairing. `canonicalName`/`libraryId` are additive on
  // curated exercises (a paired canonical term) and identify library rows;
  // `untagged` marks a custom with no muscles/pattern, excluded from math.
  source: exerciseSourceEnum("source").notNull().default("curated"),
  canonicalName: text("canonical_name"),
  libraryId: text("library_id"),
  untagged: boolean("untagged").notNull().default(false),
  notes: text("notes"),
  params: jsonb("params"), // e.g. cardio { duration_min, incline, speed }
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Join table carrying the fractional emphasis used for set-counting (§7).
// The seed's emphasis_convention is 1.0 primary / 0.5 meaningful secondary / 0.3 minor
// secondary — finer-grained than the spec's flat "primary 1.0, secondary 0.5" statement.
// We store the actual seed value and use it directly (see DECISIONS.md).
export const exerciseMuscles = pgTable(
  "exercise_muscles",
  {
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    muscle: text("muscle")
      .notNull()
      .references(() => muscles.id),
    role: muscleRoleEnum("role").notNull(),
    emphasis: numeric("emphasis").notNull(),
  },
  (t) => [primaryKey({ columns: [t.exerciseId, t.muscle] })]
);

export const exerciseSubstitutions = pgTable("exercise_substitutions", {
  id: serial("id").primaryKey(),
  exerciseId: text("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  equipment: text("equipment").array().notNull().default([]),
  loadType: loadTypeEnum("load_type"),
  whenContext: text("when_context"),
  note: text("note"),
  inRoutine: boolean("in_routine").notNull().default(false),
  // Populated once a substitution candidate is promoted to its own exercise node.
  candidateExerciseId: text("candidate_exercise_id").references(() => exercises.id),
});

export const machines = pgTable("machines", {
  id: text("id").primaryKey(),
  gym: text("gym"),
  brand: text("brand"),
  model: text("model"),
  pulleyRatio: numeric("pulley_ratio"),
  counterweightLb: numeric("counterweight_lb"), // Smith bar ~15-20 lb at PF
  camProfile: text("cam_profile"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

export const programs = pgTable("programs", {
  id: serial("id").primaryKey(),
  splitType: text("split_type").notNull(),
  active: boolean("active").notNull().default(true),
  // A reusable-block library is just a hidden "program" whose program_days are
  // the blocks (e.g. "Abs — machine", "Cardio"). This reuses the entire
  // program/day/exercise structure + CRUD lib rather than duplicating it. Only
  // one such row exists; listPrograms() excludes it so it never shows in the
  // program switcher. See DECISIONS.md.
  isBlockLibrary: boolean("is_block_library").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// A day is real, ordered, renameable data — not a hardcoded tag. order_index
// here is what drives the day picker's sort order (replaces the old DAY_ORDER
// literal that used to live in the program API; see DECISIONS.md).
export const programDays = pgTable("program_days", {
  id: serial("id").primaryKey(),
  programId: integer("program_id")
    .notNull()
    .references(() => programs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
});

export const programExercises = pgTable("program_exercises", {
  id: serial("id").primaryKey(),
  // programId lives on program_days now (day -> program), avoiding a
  // duplicate/driftable FK here.
  dayId: integer("day_id")
    .notNull()
    .references(() => programDays.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id")
    .notNull()
    .references(() => exercises.id),
  targetSets: integer("target_sets").notNull(),
  repRange: text("rep_range"),
  rirTarget: numeric("rir_target"),
  orderIndex: integer("order_index").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Logging (spec §6 — WorkoutLog / SetLog)
// ---------------------------------------------------------------------------

export const workoutLogs = pgTable("workout_logs", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  programDay: text("program_day"),
  programId: integer("program_id").references(() => programs.id),
  notes: text("notes"),
  // Stamped when the user taps "Finish session" (spec §7a lifecycle). Nullable:
  // a session in progress has no finish time. Not a one-way door — re-finishing
  // re-stamps it. withTimezone since it's compared/displayed as a real instant.
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const setLogs = pgTable("set_logs", {
  id: serial("id").primaryKey(),
  workoutLogId: integer("workout_log_id")
    .notNull()
    .references(() => workoutLogs.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id")
    .notNull()
    .references(() => exercises.id),
  // Machine/Smith/cable loads are context-bound; null for portable free-weight/bodyweight lifts.
  machineId: text("machine_id").references(() => machines.id),
  setIndex: integer("set_index").notNull(),
  setType: setTypeEnum("set_type").notNull(),
  load: numeric("load").notNull(),
  reps: integer("reps").notNull(),
  // Primary effort signal is the tag; `rir` stays as an optional exact number
  // if the user wants to be precise. The adapter prefers an exact rir when
  // present, else derives one from `effort`.
  effort: effortEnum("effort"),
  rir: numeric("rir"),
  romNote: text("rom_note"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Cardio / conditioning gets its own shape (duration/incline/speed/… — never
// sets×reps×load) and its own table. Keeping it out of set_logs is structural,
// not a filter: the deterministic core only ever reads set_logs, so cardio is
// physically invisible to the volume/progression math (spec §7a / seed's
// conditioning_only). See DECISIONS.md.
export const cardioLogs = pgTable("cardio_logs", {
  id: serial("id").primaryKey(),
  workoutLogId: integer("workout_log_id")
    .notNull()
    .references(() => workoutLogs.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id")
    .notNull()
    .references(() => exercises.id),
  durationMin: numeric("duration_min"),
  incline: numeric("incline"),
  speed: numeric("speed"),
  distance: numeric("distance"),
  level: numeric("level"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const injuryFlags = pgTable("injury_flags", {
  id: serial("id").primaryKey(),
  structure: text("structure").notNull(), // e.g. "lumbar_spine"
  severity: text("severity"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Later-phase tables (spec §6) — created now so the schema matches the model,
// but nothing in this session reads or writes them. Nullable/unused for now.
// ---------------------------------------------------------------------------

export const bodyMetrics = pgTable("body_metrics", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  weight: numeric("weight"),
  measurements: jsonb("measurements"),
});

export const progressPhotos = pgTable("progress_photos", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  pose: text("pose"),
  storageRef: text("storage_ref"), // encrypted at rest
  notes: text("notes"),
});

export const recoveryMetrics = pgTable("recovery_metrics", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  sleep: numeric("sleep"),
  hrv: numeric("hrv"),
  restingHr: numeric("resting_hr"),
  readiness: numeric("readiness"),
  steps: integer("steps"),
  activeKcal: numeric("active_kcal"),
});

export const nutritionEntries = pgTable("nutrition_entries", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  source: text("source"),
  foodRef: text("food_ref"),
  kcal: numeric("kcal"),
  protein: numeric("protein"),
  carbs: numeric("carbs"),
  fat: numeric("fat"),
  sourceTier: integer("source_tier"), // 1 | 2 | 3
  confidence: numeric("confidence"),
  discrepancyFlag: boolean("discrepancy_flag").default(false),
});

export const formChecks = pgTable("form_checks", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  exerciseId: text("exercise_id").references(() => exercises.id),
  view: text("view"), // side | front | 45
  metrics: jsonb("metrics"), // { reps, depth, tempo_s, rom_consistency, l_r_symmetry }
  llmCues: text("llm_cues").array(),
  confidence: numeric("confidence"),
  flaggedIssues: text("flagged_issues").array(),
});
