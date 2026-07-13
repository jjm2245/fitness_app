import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { machines, exerciseMachines, setLogs } from "@/db/schema";

// GET /api/exercises/[id]/machines — the machines curated for this exercise
// (Part 3c): the explicit associations plus any machine that already appears in
// this exercise's logged sets (so history-only machines still show up), with a
// logged-set count each. "No machine" (the portable/free lane) isn't a row —
// it's always available as the empty selection.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const assoc = await db
    .select({ machineId: exerciseMachines.machineId })
    .from(exerciseMachines)
    .where(eq(exerciseMachines.exerciseId, id));

  const used = await db
    .select({ machineId: setLogs.machineId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(setLogs)
    .where(eq(setLogs.exerciseId, id))
    .groupBy(setLogs.machineId);

  const usedCount = new Map<string, number>();
  for (const u of used) if (u.machineId) usedCount.set(u.machineId, u.n);

  const ids = Array.from(new Set([...assoc.map((a) => a.machineId), ...usedCount.keys()]));
  const rows = ids.length
    ? await db.select({ id: machines.id, notes: machines.notes }).from(machines).where(inArray(machines.id, ids))
    : [];

  return NextResponse.json(
    rows
      .map((m) => ({ id: m.id, notes: m.notes, loggedCount: usedCount.get(m.id) ?? 0 }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

// POST /api/exercises/[id]/machines { label, notes? } — curate a machine for
// this exercise ahead of logging (create the global machine if new, associate).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  const notes = typeof body?.notes === "string" && body.notes.trim() !== "" ? body.notes.trim() : null;

  await db.insert(machines).values({ id: label, notes }).onConflictDoNothing();
  await db.insert(exerciseMachines).values({ exerciseId: id, machineId: label }).onConflictDoNothing();
  return NextResponse.json({ id: label, notes, loggedCount: 0 }, { status: 201 });
}
