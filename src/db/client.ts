import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Local dev connects over a Unix socket to a trust-auth Postgres with no SSL
// support. Production (Neon or similar managed Postgres) requires SSL and is
// reached over TCP with a real hostname. Distinguish by inspecting the
// connection string rather than NODE_ENV, so a prod-like DATABASE_URL works
// correctly even when testing locally against a remote DB.
function resolveSsl(connectionString: string | undefined): boolean | { rejectUnauthorized: boolean } {
  if (!connectionString) return false;
  if (connectionString.includes("sslmode=require") || connectionString.includes("sslmode=verify-full")) {
    return { rejectUnauthorized: true };
  }
  if (connectionString.includes("host=/tmp") || connectionString.includes("localhost")) {
    return false;
  }
  // Any other real hostname (managed Postgres) — default to requiring SSL.
  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(process.env.DATABASE_URL),
  // Small pool: serverless functions should hold few connections each — use
  // the DATABASE_URL's *pooled* (PgBouncer) endpoint in production so the
  // database itself tolerates many concurrent function instances. See
  // DECISIONS.md.
  max: 5,
});

export const db = drizzle(pool, { schema });
