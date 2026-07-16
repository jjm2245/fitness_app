-- Equipment model (Part 3): rename Machines -> Equipment and split type from
-- instance. All RENAMEs are metadata-only (zero row rewrites). Equipment =
-- how resistance is applied to a strength set.
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "machines" WHERE "pulley_ratio" IS NOT NULL) THEN
    RAISE EXCEPTION 'pulley_ratio has values - aborting guarded drop';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "machines" RENAME TO "equipment";
--> statement-breakpoint
ALTER TABLE "equipment" RENAME COLUMN "machine_type" TO "equipment_type";
--> statement-breakpoint
ALTER TABLE "equipment" DROP COLUMN "pulley_ratio";
--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "pulley_ratio_kind" text DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "set_logs" RENAME COLUMN "machine_id" TO "equipment_id";
--> statement-breakpoint
ALTER TABLE "set_logs" ADD COLUMN "equipment_type" text;
--> statement-breakpoint
ALTER TABLE "exercise_machines" RENAME TO "exercise_equipment";
--> statement-breakpoint
ALTER TABLE "exercise_equipment" RENAME COLUMN "machine_id" TO "equipment_id";
