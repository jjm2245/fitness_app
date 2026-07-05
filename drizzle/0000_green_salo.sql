CREATE TYPE "public"."goal_mode" AS ENUM('recomp', 'lean_bulk', 'cut');--> statement-breakpoint
CREATE TYPE "public"."load_type" AS ENUM('free_weight', 'bodyweight', 'smith', 'cable', 'machine_selectorized', 'plate_loaded');--> statement-breakpoint
CREATE TYPE "public"."movement_pattern" AS ENUM('squat', 'hinge', 'knee_extension', 'knee_flexion', 'hip_adduction', 'hip_abduction', 'plantarflexion', 'horizontal_push', 'incline_push', 'vertical_push', 'dip', 'horizontal_pull', 'vertical_pull', 'shrug', 'lateral_raise', 'rear_delt_fly', 'chest_fly', 'elbow_flexion', 'elbow_extension', 'spinal_extension', 'trunk_flexion', 'trunk_rotation', 'conditioning');--> statement-breakpoint
CREATE TYPE "public"."muscle_role" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."set_type" AS ENUM('warmup', 'working');--> statement-breakpoint
CREATE TYPE "public"."training_age" AS ENUM('novice', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TABLE "body_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"weight" numeric,
	"measurements" jsonb
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"exercise_id" text NOT NULL,
	"muscle" text NOT NULL,
	"role" "muscle_role" NOT NULL,
	"emphasis" numeric NOT NULL,
	CONSTRAINT "exercise_muscles_exercise_id_muscle_pk" PRIMARY KEY("exercise_id","muscle")
);
--> statement-breakpoint
CREATE TABLE "exercise_substitutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" text NOT NULL,
	"name" text NOT NULL,
	"equipment" text[] DEFAULT '{}' NOT NULL,
	"load_type" "load_type",
	"when_context" text,
	"note" text,
	"in_routine" boolean DEFAULT false NOT NULL,
	"candidate_exercise_id" text
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"day" text,
	"movement_pattern" "movement_pattern" NOT NULL,
	"equipment_required" text[] DEFAULT '{}' NOT NULL,
	"load_type" "load_type" NOT NULL,
	"portable" boolean NOT NULL,
	"affected_structures" text[] DEFAULT '{}' NOT NULL,
	"unilateral" boolean DEFAULT false NOT NULL,
	"stability_demand" text,
	"skill_level" text,
	"stretch_emphasis" boolean DEFAULT false NOT NULL,
	"rep_range_default" text,
	"in_current_routine" boolean DEFAULT false NOT NULL,
	"conditioning_only" boolean DEFAULT false NOT NULL,
	"notes" text,
	"params" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"exercise_id" text,
	"view" text,
	"metrics" jsonb,
	"llm_cues" text[],
	"confidence" numeric,
	"flagged_issues" text[]
);
--> statement-breakpoint
CREATE TABLE "injury_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"structure" text NOT NULL,
	"severity" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" text PRIMARY KEY NOT NULL,
	"gym" text,
	"brand" text,
	"model" text,
	"pulley_ratio" numeric,
	"counterweight_lb" numeric,
	"cam_profile" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muscles" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"source" text,
	"food_ref" text,
	"kcal" numeric,
	"protein" numeric,
	"carbs" numeric,
	"fat" numeric,
	"source_tier" integer,
	"confidence" numeric,
	"discrepancy_flag" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"dob" date NOT NULL,
	"sex" text NOT NULL,
	"height_in" numeric NOT NULL,
	"goal_mode" "goal_mode" DEFAULT 'recomp' NOT NULL,
	"training_age" "training_age" DEFAULT 'novice' NOT NULL,
	"available_days" integer DEFAULT 6 NOT NULL,
	"equipment_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activity_seed" text DEFAULT 'sedentary' NOT NULL,
	"protein_target_g" numeric,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"day" text NOT NULL,
	"exercise_id" text NOT NULL,
	"target_sets" integer NOT NULL,
	"rep_range" text,
	"rir_target" numeric,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"split_type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"pose" text,
	"storage_ref" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "recovery_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"sleep" numeric,
	"hrv" numeric,
	"resting_hr" numeric,
	"readiness" numeric,
	"steps" integer,
	"active_kcal" numeric
);
--> statement-breakpoint
CREATE TABLE "set_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_log_id" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"machine_id" text,
	"set_index" integer NOT NULL,
	"set_type" "set_type" NOT NULL,
	"load" numeric NOT NULL,
	"reps" integer NOT NULL,
	"rir" numeric,
	"rom_note" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"program_day" text,
	"program_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_muscles_id_fk" FOREIGN KEY ("muscle") REFERENCES "public"."muscles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_substitutions" ADD CONSTRAINT "exercise_substitutions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_substitutions" ADD CONSTRAINT "exercise_substitutions_candidate_exercise_id_exercises_id_fk" FOREIGN KEY ("candidate_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_checks" ADD CONSTRAINT "form_checks_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;