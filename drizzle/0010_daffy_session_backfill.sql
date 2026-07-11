-- Backfill: give every pre-existing workout_log a stable client_session_id so
-- the sessions list, hydration, and finish-upsert can key uniformly on it (no
-- special-casing legacy date-keyed rows). Idempotent — only fills NULLs.
UPDATE "workout_logs" SET "client_session_id" = gen_random_uuid() WHERE "client_session_id" IS NULL;
