ALTER TABLE "program_exercises" ADD COLUMN "effort_target" "effort";--> statement-breakpoint
-- Backfill the authoritative effort tag from the legacy numeric rir_target,
-- bucketed (0-1 -> to failure, 2-3 -> near failure, 4+ -> relaxed/more_in_me,
-- null -> none). rir_target is left untouched so progression is unchanged.
UPDATE "program_exercises" SET "effort_target" = CASE
  WHEN "rir_target" IS NULL THEN NULL
  WHEN "rir_target"::numeric <= 1 THEN 'to_failure'::effort
  WHEN "rir_target"::numeric <= 3 THEN 'near_failure'::effort
  ELSE 'more_in_me'::effort
END;
