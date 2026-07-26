-- Equipment P4, EXPAND half — additive only, so it is safe to run BEFORE the
-- new build deploys. The live build simply ignores columns it doesn't declare.
ALTER TABLE "equipment" ADD COLUMN "plate_increment" numeric;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "add_on_weight" numeric;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "stack_max" numeric;
