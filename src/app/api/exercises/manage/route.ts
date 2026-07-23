import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, exerciseMuscles, setLogs, cardioLogs } from "@/db/schema";

// GET /api/exercises/manage — EVERY exercise, library included (the Exercises
// section shows the full catalog; the old `source != 'library'` filter made a
// tagged library pick succeed invisibly — the add-flow bug). Each row is
// classified into one of three kinds:
//   library_name   — uses the library's own name (name == canonicalName)
//   named_on_ref   — renamed: a personal display name on a library reference
//   custom         — no library link (from-scratch customs + a couple of
//                    curated originals with no library twin)
// Plus a logged-usage count so "collapse to library" can warn about history.
// ~880 rows / ~150KB for a single user — fine as one payload; the page
// search-filters client-side and caps rendering.
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
      conditioningOnly: exercises.conditioningOnly,
      day: exercises.day,
      loadType: exercises.loadType,
      description: exercises.description,
      logFields: exercises.logFields,
    })
    .from(exercises)
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

  // Additive (phase 3): the list rows' subline shows the primary muscle —
  // highest-emphasis primary-role tag per exercise. Read-only enrichment.
  const primaries = await db
    .select({
      exerciseId: exerciseMuscles.exerciseId,
      muscle: exerciseMuscles.muscle,
      emphasis: exerciseMuscles.emphasis,
    })
    .from(exerciseMuscles)
    .where(eq(exerciseMuscles.role, "primary"));
  const primaryMuscle = new Map<string, { muscle: string; emphasis: number }>();
  for (const m of primaries) {
    const cur = primaryMuscle.get(m.exerciseId);
    if (!cur || Number(m.emphasis) > cur.emphasis) {
      primaryMuscle.set(m.exerciseId, { muscle: m.muscle, emphasis: Number(m.emphasis) });
    }
  }

  const out = rows.map((e) => {
    const kind =
      e.canonicalName && e.canonicalName === e.name
        ? "library_name"
        : e.canonicalName
        ? "named_on_ref"
        : "custom";
    return { ...e, kind, loggedCount: use.get(e.id) ?? 0, primaryMuscle: primaryMuscle.get(e.id)?.muscle ?? null };
  });

  return NextResponse.json(out);
}
