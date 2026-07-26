-- How a machine's stack is MARKED (lb / kg). Additive and nullable: NULL means
-- lb, the canonical default, so every existing row keeps its current behaviour
-- and no backfill is needed. Storage stays canonical lb throughout — this
-- governs entry and display only.
ALTER TABLE "equipment" ADD COLUMN "stack_unit" text;
