import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises } from "@/db/schema";

// Free-typed custom exercise: loggable immediately but flagged untagged (no
// muscles, no movement pattern) so it's excluded from volume/substitution math
// until tagged later. Deliberately no load_type choice yet — defaults to a
// portable free weight so no machine field is forced; the user can enrich it
// when tagging support lands.
function slugify(name: string): string {
  return "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let id = slugify(name);
  // Disambiguate collisions so two different customs with the same slug can't clash.
  const [existing] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, id));
  if (existing) id = `${id}_${Date.now().toString(36)}`;

  const [row] = await db
    .insert(exercises)
    .values({
      id,
      name,
      movementPattern: null,
      loadType: "free_weight",
      portable: true,
      source: "custom",
      untagged: true,
      updatedAt: new Date(),
    })
    .returning({
      id: exercises.id,
      name: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      conditioningOnly: exercises.conditioningOnly,
      source: exercises.source,
      untagged: exercises.untagged,
      unilateral: exercises.unilateral,
    });

  return NextResponse.json(row, { status: 201 });
}
