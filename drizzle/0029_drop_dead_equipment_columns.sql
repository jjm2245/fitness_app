-- Equipment P4, CONTRACT half — run only AFTER the new build is live.
--
-- Drizzle expands `db.select().from(equipment)` into an explicit column list, so
-- a build that still DECLARES these columns will 500 on every equipment read the
-- moment they disappear. Expand/contract is what keeps that window at zero.
--
-- Both were referenced by no read, no write and no UI, and were NULL on every
-- prod row (verified immediately before each half ran).
--   counterweight_lb — an assist is better expressed as a NEGATIVE
--                      built_in_weight, which already feeds the load math.
--   cam_profile      — descriptive only; could never change a number.
ALTER TABLE "equipment" DROP COLUMN "counterweight_lb";--> statement-breakpoint
ALTER TABLE "equipment" DROP COLUMN "cam_profile";
