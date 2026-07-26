-- Equipment P4 — stack geometry in, dead descriptive columns out.
--
-- ADD (nullable, canonical lb, no backfill): what loads are SELECTABLE on the
-- unit. These drive suggestions; none is ever folded into a stored load.
ALTER TABLE "equipment" ADD COLUMN "plate_increment" numeric;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "add_on_weight" numeric;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "stack_max" numeric;--> statement-breakpoint
-- DROP: both were declared in schema.ts and referenced by no read, no write and
-- no UI, and are NULL on every row in prod (verified before this migration ran).
--   counterweight_lb — an assist is better expressed as a NEGATIVE
--                      built_in_weight, which already feeds the load math.
--   cam_profile      — descriptive only; could never change a number. Notes
--                      covers it.
ALTER TABLE "equipment" DROP COLUMN "counterweight_lb";--> statement-breakpoint
ALTER TABLE "equipment" DROP COLUMN "cam_profile";
