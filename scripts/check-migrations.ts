import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPECTED_MIGRATIONS, appliedMigrationCount } from "../src/lib/migrationStatus";

// Fails loudly (exit 1) if the database is behind the code's migrations, or if
// EXPECTED_MIGRATIONS has drifted from drizzle/meta/_journal.json. Run it in the
// release flow and/or CI so schema drift can't ship silently. Reads whatever
// DATABASE_URL is set — point it at prod to check prod (read-only).
async function main() {
  const journal = JSON.parse(
    readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")
  ) as { entries: unknown[] };
  const journalCount = journal.entries.length;

  if (EXPECTED_MIGRATIONS !== journalCount) {
    console.error(
      `✗ EXPECTED_MIGRATIONS (${EXPECTED_MIGRATIONS}) != migrations on disk (${journalCount}).\n` +
        `  Bump EXPECTED_MIGRATIONS in src/lib/migrationStatus.ts after adding a migration.`
    );
    process.exit(1);
  }

  const applied = await appliedMigrationCount();
  if (applied < journalCount) {
    console.error(
      `✗ Database is BEHIND: ${applied}/${journalCount} migrations applied.\n` +
        `  Run: npm run release   (migrate → seed → seed:library) against this DATABASE_URL.`
    );
    process.exit(1);
  }

  console.log(`✓ Schema up to date: ${applied}/${journalCount} migrations applied.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("check-migrations failed:", err);
  process.exit(1);
});
