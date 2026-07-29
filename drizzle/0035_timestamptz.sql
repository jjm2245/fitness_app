-- Every `timestamp WITHOUT time zone` column becomes `timestamptz`.
--
-- WHY: a tz-less column stores a wall-clock with no statement about which zone
-- it belongs to, so every reader has to supply that context and any reader that
-- forgets is silently wrong. It has already cost one real bug (the export
-- rendering four hours off) and one round spent disproving a false alarm on the
-- husk sweep. The ambiguity is the defect; the values were never wrong.
--
-- WHAT IS **NOT** HERE — the nine `date` columns:
--   workout_logs.date, body_metrics.date, timeline_notes.start_date/.end_date,
--   profile.dob, form_checks.date, nutrition_entries.date,
--   progress_photos.date, recovery_metrics.date
-- A weigh-in on Jul 27 is Jul 27 in every timezone. Those are calendar dates,
-- not instants, and converting one would INTRODUCE the exact bug this removes.
-- They are already `date` in Postgres, so there is nothing to do and nothing
-- below touches them.
--
-- ── The USING clause is `current_setting('TimeZone')`, NOT a literal 'UTC' ──
--
-- The standard recipe is `USING c AT TIME ZONE 'UTC'`, and it is correct on
-- prod, where Neon reports TimeZone = GMT so `now()` wrote UTC wall-clocks.
-- It is WRONG on the dev machine, which runs America/New_York for both node
-- and Postgres: local rows hold Eastern wall-clocks, and labelling them UTC
-- would shift every one of them four hours. Since migrations run local-first,
-- a hardcoded 'UTC' would corrupt the rehearsal it is meant to validate.
--
-- `current_setting('TimeZone')` interprets each stored wall-clock in the zone
-- that WROTE it, which is the same session zone in both environments. On prod
-- it is exactly equivalent to 'UTC' (TimeZone = GMT), so prod values do not
-- move: only a `+00` label is added. This is the same shim already used at the
-- three read sites, applied once at the storage layer so those sites can drop
-- it.
--
-- SAFETY, verified before writing this (read-only, against prod):
--   * Values are UTC: set_logs.created_at vs set_logs.logged_at (already
--     timestamptz) agree on 222/222 rows, max delta 1s.
--   * Both writers agree: `now()` (DB, GMT) and app `new Date()` (Vercel, UTC)
--     landed 95ms apart on the same seed run, so the two columns written by
--     both — exercises.updated_at, programs.updated_at — need no special case.
--   * Nothing to rebuild: 0 indexes, 0 views, 0 generated columns touch these
--     13 columns. The 13 constraints on them are all NOT NULL, which
--     ALTER COLUMN ... TYPE preserves.
--
-- A type change rewrites the table but drops nothing, so no build can reference
-- a missing column and the deploy is safe in either order. 1,233 rows total.

ALTER TABLE "set_logs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "session_exercises"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "workout_logs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "equipment"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "cardio_logs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "exercises"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "programs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

ALTER TABLE "profile"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint

-- Zero rows today; included anyway. A partial conversion would mean
-- remembering which columns are which, and that memory is the actual defect.
ALTER TABLE "injury_flags"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
