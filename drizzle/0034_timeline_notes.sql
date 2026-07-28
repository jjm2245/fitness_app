-- Timeline notes: dated free-text annotations for the periods BETWEEN sessions.
-- Purely additive — a new table nothing else references, so it is safe in
-- either deploy order.
--
-- Why a new table rather than reusing `injury_flags`: that one is read by
-- `loadActiveInjuryStructures()` and feeds `src/core/substitution.ts`, so a row
-- meaning "on holiday" would silently exclude exercises from substitution. It
-- is a current-state clinical filter keyed on anatomy with no dates. This is a
-- historical explanatory annotation keyed on a date range. Same word, different
-- jobs — and only one of them is allowed to change training.
CREATE TABLE "timeline_notes" (
  "id"         serial PRIMARY KEY,
  "start_date" date NOT NULL,
  -- NULL = still ongoing, not unknown.
  "end_date"   date,
  "kind"       text,
  "notes"      text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "timeline_notes_start_idx" ON "timeline_notes" ("start_date");--> statement-breakpoint
-- A NULL end stays legal; only an end BEFORE its start is refused. The UI
-- catches this first and says so in words — this is the backstop.
ALTER TABLE "timeline_notes" ADD CONSTRAINT "timeline_notes_range"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
