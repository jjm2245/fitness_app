import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { equipment, exerciseEquipment, setLogs } from "@/db/schema";

// GET /api/exercises/[id]/equipment — the equipment curated for this exercise
// (Part 3c): the explicit associations plus any machine that already appears in
// this exercise's logged sets (so history-only equipment still show up), with a
// logged-set count each. "No machine" (the portable/free lane) isn't a row —
// it's always available as the empty selection.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const assoc = await db
    .select({ equipmentId: exerciseEquipment.equipmentId })
    .from(exerciseEquipment)
    .where(eq(exerciseEquipment.exerciseId, id));

  const used = await db
    .select({ equipmentId: setLogs.equipmentId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(setLogs)
    .where(eq(setLogs.exerciseId, id))
    .groupBy(setLogs.equipmentId);

  const usedCount = new Map<string, number>();
  for (const u of used) if (u.equipmentId) usedCount.set(u.equipmentId, u.n);

  const ids = Array.from(new Set([...assoc.map((a) => a.equipmentId), ...usedCount.keys()]));
  const rows = ids.length
    ? await db
        .select({ id: equipment.id, label: equipment.label, builtInWeight: equipment.builtInWeight, notes: equipment.notes })
        .from(equipment)
        .where(inArray(equipment.id, ids))
    : [];

  return NextResponse.json(
    rows
      .map((m) => ({ id: m.id, label: m.label ?? m.id, builtInWeight: m.builtInWeight, notes: m.notes, loggedCount: usedCount.get(m.id) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );
}

// POST /api/exercises/[id]/equipment { id?, label, notes? } — curate a machine
// for this exercise ahead of logging (create the global machine if new,
// associate). The client sends its own uuid id (offline-first identity); legacy
// callers without one fall back to label-as-id.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  const equipmentId = typeof body?.id === "string" && body.id.trim() !== "" ? body.id.trim() : label;
  const notes = typeof body?.notes === "string" && body.notes.trim() !== "" ? body.notes.trim() : null;

  await db.insert(equipment).values({ id: equipmentId, label, notes }).onConflictDoNothing();
  await db.insert(exerciseEquipment).values({ exerciseId: id, equipmentId }).onConflictDoNothing();
  return NextResponse.json({ id: equipmentId, label, builtInWeight: null, notes, loggedCount: 0 }, { status: 201 });
}
