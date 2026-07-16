import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { equipment, exerciseEquipment, exercises, setLogs } from "@/db/schema";

// GET /api/equipment — the full managed machine list (Machines section, Part 3b):
// structured fields + free-text notes, which exercises reference each machine,
// and how many logged sets point at it (drives history-safe delete/merge).
export async function GET() {
  const rows = await db.select().from(equipment).orderBy(equipment.label);

  const refs = await db
    .select({ equipmentId: exerciseEquipment.equipmentId, exerciseId: exerciseEquipment.exerciseId, name: exercises.name })
    .from(exerciseEquipment)
    .innerJoin(exercises, eq(exerciseEquipment.exerciseId, exercises.id));
  const used = await db
    .select({ equipmentId: setLogs.equipmentId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(setLogs)
    .groupBy(setLogs.equipmentId);

  const refsBy = new Map<string, Array<{ exerciseId: string; name: string }>>();
  for (const r of refs) (refsBy.get(r.equipmentId) ?? refsBy.set(r.equipmentId, []).get(r.equipmentId)!).push({ exerciseId: r.exerciseId, name: r.name });
  const usedBy = new Map<string, number>();
  for (const u of used) if (u.equipmentId) usedBy.set(u.equipmentId, u.n);

  return NextResponse.json(
    rows.map((m) => ({
      id: m.id,
      label: m.label ?? m.id,
      gym: m.gym,
      brand: m.brand,
      model: m.model,
      builtInWeight: m.builtInWeight,
      equipmentType: m.equipmentType,
      notes: m.notes,
      exercises: refsBy.get(m.id) ?? [],
      loggedCount: usedBy.get(m.id) ?? 0,
    }))
  );
}

// POST /api/equipment { id?, label, ... } — create a machine. The client owns
// identity (a uuid) so a machine created offline maps to exactly one row on
// sync; legacy callers without a separate label fall back to label-as-id.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : typeof body?.id === "string" ? body.id.trim() : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  const id = typeof body?.id === "string" && body.id.trim() !== "" ? body.id.trim() : label;

  const [row] = await db
    .insert(equipment)
    .values({
      id,
      label,
      notes: typeof body?.notes === "string" && body.notes.trim() !== "" ? body.notes.trim() : null,
      builtInWeight: typeof body?.builtInWeight === "number" ? body.builtInWeight.toString() : null,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return NextResponse.json(row, { status: 201 });
  const [existing] = await db.select().from(equipment).where(eq(equipment.id, id));
  return NextResponse.json(existing, { status: 200 });
}
