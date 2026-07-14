-- Read-only production schema/state inspector.
-- Run against any DATABASE_URL to see what's applied vs. missing. SELECTs only —
-- it writes nothing. Usage:
--   psql "$DATABASE_URL" -f scripts/inspect-db.sql
-- (For Neon, use the pooled connection string. This is safe to run on prod.)

\echo '== Applied migrations (expect 13: 0000..0012) =='
SELECT count(*) AS applied_migrations FROM drizzle.__drizzle_migrations;

\echo '== Key schema markers per migration (t = present) =='
SELECT
  (to_regclass('public.workout_logs') IS NOT NULL)                                                   AS base_schema_0000,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='workout_logs' AND column_name='client_session_id')                       AS client_session_id_0009,
  (to_regclass('public.session_exercises') IS NOT NULL)                                              AS session_exercises_0011,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='set_logs' AND column_name='session_exercise_id')                         AS setlog_occurrence_fk_0011,
  (to_regclass('public.exercise_machines') IS NOT NULL)                                              AS exercise_machines_0012;

\echo '== Exercise graph seed state (local baseline: curated 41 / library 834 / custom 1) =='
SELECT source, count(*) FROM exercises GROUP BY source ORDER BY source;

\echo '== Library merge applied? (0 = library twins NOT removed / library seed not re-run) =='
SELECT count(*) AS unmerged_library_twins
FROM exercises
WHERE source='library' AND name IN ('Leg Extensions','Barbell Squat','Machine Bench Press','Butterfly','Stairmaster');

\echo '== Backfill 0010: existing workout_logs given a client_session_id? =='
SELECT count(*) FILTER (WHERE client_session_id IS NULL) AS null_client_ids,
       count(*)                                          AS total_workout_logs
FROM workout_logs;
