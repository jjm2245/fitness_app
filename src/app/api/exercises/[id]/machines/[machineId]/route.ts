import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exerciseMachines } from "@/db/schema";

// DELETE /api/exercises/[id]/machines/[machineId] — remove a machine from this
// exercise's curated list (Part 3c). Only the association is dropped; the global
// machine row and any logged sets that reference it are left intact (removing
// from the curated list must never orphan history). The machine simply stops
// appearing as an option for this exercise going forward.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; machineId: string }> }) {
  const { id, machineId } = await params;
  await db
    .delete(exerciseMachines)
    .where(and(eq(exerciseMachines.exerciseId, id), eq(exerciseMachines.machineId, decodeURIComponent(machineId))));
  return NextResponse.json({ ok: true });
}
