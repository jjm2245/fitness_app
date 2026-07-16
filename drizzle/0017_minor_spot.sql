ALTER TABLE "workout_logs" ADD COLUMN "first_finished_at" timestamp with time zone;--> statement-breakpoint
UPDATE "workout_logs" SET "first_finished_at" = "finished_at" WHERE "first_finished_at" IS NULL AND "finished_at" IS NOT NULL;
