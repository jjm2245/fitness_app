ALTER TABLE "program_exercises" DROP CONSTRAINT "program_exercises_program_id_programs_id_fk";
--> statement-breakpoint
ALTER TABLE "program_exercises" ALTER COLUMN "day_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" DROP COLUMN "program_id";--> statement-breakpoint
ALTER TABLE "program_exercises" DROP COLUMN "day";