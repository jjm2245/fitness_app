CREATE TABLE "cardio_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_log_id" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"duration_min" numeric,
	"incline" numeric,
	"speed" numeric,
	"distance" numeric,
	"level" numeric,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cardio_logs" ADD CONSTRAINT "cardio_logs_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardio_logs" ADD CONSTRAINT "cardio_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;