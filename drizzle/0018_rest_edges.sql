-- Rest is an edge between sets of the same occurrence (restBefore): N sets =
-- N-1 rests, null on set 1. Derived rests previously landed on the FIRST set of
-- an occurrence from the gap since the previous exercise -- an inter-exercise
-- transition, not a rest. Null those phantoms; user/timed entries are kept.
UPDATE "set_logs" SET "rest_seconds" = NULL, "rest_source" = NULL
WHERE "rest_source" = 'derived'
  AND "id" IN (
    SELECT MIN("id") FROM "set_logs"
    WHERE "session_exercise_id" IS NOT NULL
    GROUP BY "session_exercise_id"
  );
