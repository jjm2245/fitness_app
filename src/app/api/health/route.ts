import { NextResponse } from "next/server";
import { getMigrationStatus } from "@/lib/migrationStatus";

// GET /api/health — liveness + schema-parity check. Public (unauthenticated) so
// an uptime monitor can watch it. Returns 503 when the deployed code expects
// more migrations than the database has applied — the exact drift that Vercel's
// auto-deploy-but-manual-migrations setup produces. A red /api/health after a
// deploy means: run `npm run release` against the prod DATABASE_URL.
export async function GET() {
  try {
    const migrations = await getMigrationStatus();
    const body = { ok: !migrations.behind, migrations };
    return NextResponse.json(body, { status: migrations.behind ? 503 : 200 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "db_unreachable", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
