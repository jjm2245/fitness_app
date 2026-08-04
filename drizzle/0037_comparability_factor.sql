-- Owner-declared comparability (Stats v1.1).
--
-- v1 stored only engine-suggested decisions. The combine flow now lets the
-- owner declare a relationship the specs can't derive — "these are the same
-- setup" or "reads ×N against the other" — and a scaled estimate needs its
-- factor STORED, because unlike a pulley ratio it exists nowhere else.
--
-- `factor` is NULL for same_setup and for spec-suggested ratio estimates
-- (whose ratio lives on the equipment rows). It is REQUIRED when the basis is
-- an owner declaration of kind ratio_estimate — that is the one case where
-- deleting the row would delete the number itself. Enforced by CHECK rather
-- than convention.
--
-- Basis conventions for owner-declared rows (checked by prefix in the app,
-- recorded here for the reader): 'owner-declared same setup',
-- 'owner-declared ×N …', 'owner-declared kept separate'.
--
-- Additive: old code ignores the column, so migrate-then-deploy is safe in
-- that order (same sequence as 0036).

ALTER TABLE "equipment_comparability" ADD COLUMN "factor" numeric;--> statement-breakpoint

ALTER TABLE "equipment_comparability" ADD CONSTRAINT "eq_comp_factor_positive"
  CHECK ("factor" IS NULL OR "factor" > 0);--> statement-breakpoint

-- A CONFIRMED owner-declared ratio estimate without its factor is a
-- contradiction — the declaration IS the number. A REJECTED row carries no
-- factor by design: "keep these separate" is not a ratio. (Caught live: the
-- unqualified version made rejecting a scaled pair impossible.)
ALTER TABLE "equipment_comparability" ADD CONSTRAINT "eq_comp_owner_ratio_needs_factor"
  CHECK (NOT ("kind" = 'ratio_estimate' AND "status" = 'confirmed' AND "basis" LIKE 'owner-declared%') OR "factor" IS NOT NULL);
