-- Machine-comparability decisions — and ONLY decisions. Suggestions are
-- computed on demand from equipment specs (src/lib/comparability.ts) and are
-- never stored: storing one would create a second copy of the specs' opinion,
-- free to go stale the moment a spec is edited. What persists is the owner's
-- answer, which carries knowledge the specs cannot hold (same physical model?
-- same cam?). Pair-level, exercise-agnostic; a rejected pair stays rejected.
--
-- `basis` snapshots the generated reasoning AT DECISION TIME — a later spec
-- edit cannot silently change what was agreed to. It is also the landing site
-- for the future measured-overlap calibration (existing backlog item).
--
-- Rendering-only by contract: confirmed rows change how CHART series are drawn
-- (shared axis / dashed estimate). Lists, deltas, bests, PR chips and index
-- figures are byte-identical with or without rows here. Nothing in src/core/*
-- reads this table.
CREATE TABLE "equipment_comparability" (
  "id" serial PRIMARY KEY,
  "equipment_id_a" text NOT NULL REFERENCES "equipment"("id"),
  "equipment_id_b" text NOT NULL REFERENCES "equipment"("id"),
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "basis" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  -- One canonical row per pair: a < b by unit id, so (A,B) and (B,A) cannot
  -- both exist. The app orders before writing; this is the backstop.
  CONSTRAINT "eq_comp_pair_order" CHECK ("equipment_id_a" < "equipment_id_b"),
  CONSTRAINT "eq_comp_kind" CHECK ("kind" IN ('same_setup', 'ratio_estimate')),
  CONSTRAINT "eq_comp_status" CHECK ("status" IN ('confirmed', 'rejected')),
  CONSTRAINT "eq_comp_pair_kind_unique" UNIQUE ("equipment_id_a", "equipment_id_b", "kind")
);
