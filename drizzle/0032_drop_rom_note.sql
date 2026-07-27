-- CONTRACT half of the rom_note removal. Safe ONLY because the build that no
-- longer selects this column is already live (0afcc01) — drizzle expands
-- `db.select().from(setLogs)` into an explicit column list, so running this
-- against an older deploy would 500 every set read.
--
-- rom_note was written by nothing and read by nothing across its whole life:
-- 0 of 215 rows populated. Same treatment as counterweight_lb. The surviving
-- free-text field for a set is `notes`, now exposed in the set-edit sheet.
ALTER TABLE "set_logs" DROP COLUMN "rom_note";
