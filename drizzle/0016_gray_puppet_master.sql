ALTER TABLE "machines" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "built_in_weight" numeric;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "machine_type" text;--> statement-breakpoint
UPDATE "machines" SET "label" = "id" WHERE "label" IS NULL;
