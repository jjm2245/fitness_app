CREATE TYPE "public"."exercise_source" AS ENUM('curated', 'library', 'custom');--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "movement_pattern" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "source" "exercise_source" DEFAULT 'curated' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "canonical_name" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "library_id" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "untagged" boolean DEFAULT false NOT NULL;