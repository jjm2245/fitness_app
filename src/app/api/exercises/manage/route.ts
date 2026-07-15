import { NextResponse } from "next/server";
import { ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, setLogs, cardioLogs } from "@/db/schema";

// GET /api/exercises/manage — the exercises worth managing: everything that
// isn't a raw library row (curated + custom). Each is classified into one of
// three kinds the user asked to tell apart (Part 3b):
//   library_name   — uses the library's own name (name == canonicalName)
//   named_on_ref   — a precise display name on a library reference (name differs)
//   custom         — a from-scratch custom with no library link
// Plus a logged-usage count so "collapse to library" can warn about history.
export async function GET() {
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      source: exercises.source,
      canonicalName: exercises.canonicalName,
      movementPattern: exercises.movementPattern,
      untagged: exercises.untagged,
      unilateral: exercises.unilateral,
      day: exercises.day,
      loadType: exercises.loadType,
      description: exercises.description,
    })
    .from(exercises)
    .where(ne(exercises.source, "library"))
    .orderBy(exercises.name);

  const setUse = await db
    .select({ exerciseId: setLogs.exerciseId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(setLogs)
    .groupBy(setLogs.exerciseId);
  const cardioUse = await db
    .select({ exerciseId: cardioLogs.exerciseId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(cardioLogs)
    .groupBy(cardioLogs.exerciseId);
  const use = new Map<string, number>();
  for (const r of setUse) use.set(r.exerciseId, (use.get(r.exerciseId) ?? 0) + r.n);
  for (const r of cardioUse) use.set(r.exerciseId, (use.get(r.exerciseId) ?? 0) + r.n);

  const out = rows.map((e) => {
    const kind =
      e.canonicalName && e.canonicalName === e.name
        ? "library_name"
        : e.canonicalName
        ? "named_on_ref"
        : "custom";
    return { ...e, kind, loggedCount: use.get(e.id) ?? 0 };
  });

  return NextResponse.json(out);
}
