import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// The number of migrations the current code expects to be applied. Vercel
// auto-deploys `main` but migrations are manual, so shipped code can outrun the
// prod schema; this constant + /api/health turn that silent 500 into a loud
// signal, and `npm run db:check` fails if this drifts from
// drizzle/meta/_journal.json (so it can't silently rot when a migration is
// added). BUMP THIS whenever you add a migration.
export const EXPECTED_MIGRATIONS = 24;

// How many migrations drizzle records as applied. A missing tracking table
// (nothing migrated yet) reads as 0 rather than throwing.
export async function appliedMigrationCount(): Promise<number> {
  try {
    const res = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
    return rows?.[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

export interface MigrationStatus {
  applied: number;
  expected: number;
  behind: boolean;
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const applied = await appliedMigrationCount();
  return { applied, expected: EXPECTED_MIGRATIONS, behind: applied < EXPECTED_MIGRATIONS };
}
