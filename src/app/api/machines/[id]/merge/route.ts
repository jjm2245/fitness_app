import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { machines, exerciseMachines, setLogs } from "@/db/schema";

// POST /api/machines/[id]/merge { targetId } — merge this machine into another
// (duplicate labels, same physical machine registered twice). Same pattern as
// exercise collapse: re-point every reference (set_logs.machine_id +
// exercise_machines, deduped) onto the target, then delete the source — logged
// history moves, never orphans. Explicit and user-initiated only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const sourceId = decodeURIComponent(rawId);
  const body = await request.json().catch(() => null);
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  if (!targetId) return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  if (targetId === sourceId) return NextResponse.json({ error: "Can't merge a machine into itself" }, { status: 400 });

  const moved = await db.transaction(async (tx) => {
    const [source] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, sourceId));
    const [target] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, targetId));
    if (!source || !target) return null;

    // Move logged history onto the target.
    const sets = await tx.update(setLogs).set({ machineId: targetId }).where(eq(setLogs.machineId, sourceId)).returning({ id: setLogs.id });

    // Re-point exercise associations, deduping against ones the target already has.
    const links = await tx.select().from(exerciseMachines).where(eq(exerciseMachines.machineId, sourceId));
    for (const l of links) {
      await tx.insert(exerciseMachines).values({ exerciseId: l.exerciseId, machineId: targetId }).onConflictDoNothing();
      await tx
        .delete(exerciseMachines)
        .where(and(eq(exerciseMachines.exerciseId, l.exerciseId), eq(exerciseMachines.machineId, sourceId)));
    }

    await tx.delete(machines).where(eq(machines.id, sourceId));
    return { sets: sets.length, links: links.length };
  });

  if (!moved) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, movedSets: moved.sets, movedLinks: moved.links });
}
