import { NextRequest, NextResponse } from "next/server";
import { or, ilike, asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises } from "@/db/schema";

// Search across the whole exercise graph (curated + library + custom) by name
// or canonical name. Curated results rank first (they're your hand-tagged core),
// then library, then custom.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(searchParams.get("limit") ?? "25"), 50);
  if (q.length < 2) return NextResponse.json([]);

  const like = `%${q}%`;
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      conditioningOnly: exercises.conditioningOnly,
      source: exercises.source,
      untagged: exercises.untagged,
      unilateral: exercises.unilateral,
      canonicalName: exercises.canonicalName,
    })
    .from(exercises)
    .where(or(ilike(exercises.name, like), ilike(exercises.canonicalName, like)))
    .orderBy(sql`case ${exercises.source} when 'curated' then 0 when 'library' then 1 else 2 end`, asc(exercises.name))
    .limit(limit);

  return NextResponse.json(rows);
}
