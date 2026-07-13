import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, movementPatternEnum } from "@/db/schema";

type MovementPattern = (typeof movementPatternEnum.enumValues)[number];
const PATTERNS = new Set<string>(movementPatternEnum.enumValues);

// PATCH /api/exercises/[id] — update an exercise: assign a movement pattern
// (the "graduation" step of movement-pattern-on-add, Part B — makes it
// substitutable and clears untagged) and/or rename it (custom-exercise
// management, Part 3b). Both are optional; at least one must be present.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const updates: { movementPattern?: MovementPattern; untagged?: boolean; name?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (body?.movementPattern !== undefined) {
    if (typeof body.movementPattern !== "string" || !PATTERNS.has(body.movementPattern)) {
      return NextResponse.json({ error: "Valid movementPattern is required" }, { status: 400 });
    }
    updates.movementPattern = body.movementPattern as MovementPattern;
    updates.untagged = false;
  }

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") return NextResponse.json({ error: "name can't be empty" }, { status: 400 });
    updates.name = name;
  }

  if (updates.movementPattern === undefined && updates.name === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .update(exercises)
    .set(updates)
    .where(eq(exercises.id, id))
    .returning({
      id: exercises.id,
      name: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      conditioningOnly: exercises.conditioningOnly,
      source: exercises.source,
      untagged: exercises.untagged,
      canonicalName: exercises.canonicalName,
      movementPattern: exercises.movementPattern,
    });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
