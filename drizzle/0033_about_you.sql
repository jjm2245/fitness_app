-- "About you" — additive and widening only. Nothing is dropped, and both tables
-- are empty (profile 0 rows, body_metrics 0 rows), so this cannot disturb data.
--
-- Widening NOT NULL → NULL is safe in EITHER deploy order: no existing row can
-- violate a constraint that is being relaxed, and a live build that still thinks
-- the column is NOT NULL simply never writes a NULL. Unlike the 0031/0032 pair
-- this needs no expand/contract split.

-- 1. The absence fix. These three were NOT NULL with no defaults, so a
--    partially filled form could not be saved at all — the table meant to hold
--    the most optional data in the app was the one place NULL was forbidden.
ALTER TABLE "profile" ALTER COLUMN "dob" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "sex" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "height_in" DROP NOT NULL;--> statement-breakpoint

-- 2. Years of consistent training, replacing the novice/intermediate/advanced
--    category in the UI. Additive: the `training_age` enum column stays exactly
--    as it is (NOT NULL with a default), so nothing that might read it breaks.
ALTER TABLE "profile" ADD COLUMN "training_years" numeric;--> statement-breakpoint

-- 3. Singleton guard. One user, one profile row; a second row would silently
--    split the source of truth.
ALTER TABLE "profile" ADD CONSTRAINT "profile_singleton" CHECK ("id" = 1);--> statement-breakpoint

-- 4. One weigh-in per date. Without this, correcting this morning's weight
--    three times leaves three rows for one morning and "latest" becomes a
--    coin toss between them.
CREATE UNIQUE INDEX "body_metrics_date_uniq" ON "body_metrics" ("date");
