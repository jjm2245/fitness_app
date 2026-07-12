import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, movementPatternEnum } from "@/db/schema";

type MovementPattern = (typeof movementPatternEnum.enumValues)[number];
const PATTERNS = new Set<string>(movementPatternEnum.enumValues);

// PATCH /api/exercises/[id] — assign (or change) an exercise's movement pattern.
// This is the "graduation" step of movement-pattern-on-add (Part B): giving an
// untagged library/custom exercise a pattern makes it substitutable and clears
// the untagged flag. Muscle-emphasis authoring stays a later job — pattern is
// what unlocks substitution, and it's the one thing a person can pick reliably.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const movementPattern = body?.movementPattern;

  if (typeof movementPattern !== "string" || !PATTERNS.has(movementPattern)) {
    return NextResponse.json({ error: "Valid movementPattern is required" }, { status: 400 });
  }

  const [row] = await db
    .update(exercises)
    .set({ movementPattern: movementPattern as MovementPattern, untagged: false, updatedAt: new Date() })
    .where(eq(exercises.id, id))
    .returning({
      id: exercises.id,
      name: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      conditioningOnly: exercises.conditioningOnly,
      source: exercises.source,
      untagged: exercises.untagged,
      movementPattern: exercises.movementPattern,
    });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
