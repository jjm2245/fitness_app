import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exerciseEquipment } from "@/db/schema";

// DELETE /api/exercises/[id]/equipment/[equipmentId] — remove a machine from this
// exercise's curated list (Part 3c). Only the association is dropped; the global
// machine row and any logged sets that reference it are left intact (removing
// from the curated list must never orphan history). The machine simply stops
// appearing as an option for this exercise going forward.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; equipmentId: string }> }) {
  const { id, equipmentId } = await params;
  await db
    .delete(exerciseEquipment)
    .where(and(eq(exerciseEquipment.exerciseId, id), eq(exerciseEquipment.equipmentId, decodeURIComponent(equipmentId))));
  return NextResponse.json({ ok: true });
}
