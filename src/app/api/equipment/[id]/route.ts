import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { equipment, setLogs } from "@/db/schema";

// PATCH /api/equipment/[id] — edit a machine's fields (Machines section, 3b).
// The id is an opaque stable key referenced by logged sets, so it never changes;
// a rename edits `label` only (one row). Renaming INTO a label another machine
// already uses returns 409 duplicate_label — an explicit warning, never a silent
// merge (use the merge endpoint for genuine merges).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const body = await request.json().catch(() => null);

  const updates: {
    label?: string;
    gym?: string | null;
    brand?: string | null;
    model?: string | null;
    builtInWeight?: string | null;
    equipmentType?: string | null;
    notes?: string | null;
    pulleyRatioKind?: string;
  } = {};

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  if (body?.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "label can't be empty" }, { status: 400 });
    const [dup] = await db
      .select({ id: equipment.id, label: equipment.label })
      .from(equipment)
      .where(and(eq(equipment.label, label), ne(equipment.id, id)));
    if (dup) {
      return NextResponse.json(
        { error: "duplicate_label", message: `Another machine is already labelled "${label}" — merge into it instead?`, existingId: dup.id },
        { status: 409 }
      );
    }
    updates.label = label;
  }
  if (body?.gym !== undefined) updates.gym = str(body.gym);
  if (body?.brand !== undefined) updates.brand = str(body.brand);
  if (body?.model !== undefined) updates.model = str(body.model);
  if (body?.equipmentType !== undefined) updates.equipmentType = str(body.equipmentType);
  if (body?.notes !== undefined) updates.notes = str(body.notes);
  if (body?.pulleyRatioKind !== undefined) {
    if (!["1:1", "2:1", "other", "unknown"].includes(body.pulleyRatioKind)) return NextResponse.json({ error: "invalid pulleyRatioKind" }, { status: 400 });
    updates.pulleyRatioKind = body.pulleyRatioKind;
  }
  if (body?.builtInWeight !== undefined) {
    if (body.builtInWeight === null || body.builtInWeight === "") updates.builtInWeight = null;
    else if (typeof body.builtInWeight === "number" && Number.isFinite(body.builtInWeight)) updates.builtInWeight = body.builtInWeight.toString();
    else return NextResponse.json({ error: "builtInWeight must be a number" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [row] = await db.update(equipment).set(updates).where(eq(equipment.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

// DELETE /api/equipment/[id] — history-safe: refuses (409) while logged sets
// reference the machine, so past loads never lose their context. Merge instead
// to move history. exercise_machines links cascade away with the row.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  const [used] = await db.select({ id: setLogs.id }).from(setLogs).where(eq(setLogs.equipmentId, id)).limit(1);
  if (used) {
    return NextResponse.json(
      { error: "referenced", message: "Logged sets reference this machine — merge it into another instead of deleting." },
      { status: 409 }
    );
  }

  const [row] = await db.delete(equipment).where(eq(equipment.id, id)).returning({ id: equipment.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
