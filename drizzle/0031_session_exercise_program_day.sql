-- Occurrence → program day link. EXPAND half: additive only, so it is safe to
-- run BEFORE the new build deploys (the live build ignores columns it doesn't
-- declare).
--
-- ON DELETE SET NULL IS LOAD-BEARING — DO NOT CHANGE IT TO CASCADE.
--
-- This is the first foreign key pointing from LOGGED HISTORY into PLAN rows.
--
-- Measured, not assumed (the proof is in DECISIONS 2026-07-27). Under CASCADE,
-- deleting one program day destroyed ALL THREE occurrences pointing at it. The
-- `set_logs` rows themselves survived — `set_logs.session_exercise_id` is
-- itself ON DELETE SET NULL, and the sets keep `workout_log_id` — so the volume
-- checksum held. What a stray CASCADE actually costs is the session's STRUCTURE:
-- its ordered exercise list, its per-occurrence `completed` flags, and every
-- set's link to the occurrence it belongs to.
--
-- Not "months of sets deleted", then, but a session gutted into a loose bag of
-- sets — and triggered by an ordinary tidy-up in the program editor, on rows
-- the user would never connect to their history.
--
-- SET NULL degrades a deleted day's occurrences to "ad-hoc", which is exactly
-- what they become. NULL already means ad-hoc for this column.
ALTER TABLE "session_exercises"
  ADD COLUMN "program_day_id" integer;--> statement-breakpoint
ALTER TABLE "session_exercises"
  ADD CONSTRAINT "session_exercises_program_day_id_program_days_id_fk"
  FOREIGN KEY ("program_day_id") REFERENCES "public"."program_days"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
