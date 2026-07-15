import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { machines, setLogs } from "@/db/schema";

// PATCH /api/machines/[id] — edit a machine's fields (Machines section, 3b).
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
    machineType?: string | null;
    notes?: string | null;
  } = {};

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  if (body?.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "label can't be empty" }, { status: 400 });
    const [dup] = await db
      .select({ id: machines.id, label: machines.label })
      .from(machines)
      .where(and(eq(machines.label, label), ne(machines.id, id)));
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
  if (body?.machineType !== undefined) updates.machineType = str(body.machineType);
  if (body?.notes !== undefined) updates.notes = str(body.notes);
  if (body?.builtInWeight !== undefined) {
    if (body.builtInWeight === null || body.builtInWeight === "") updates.builtInWeight = null;
    else if (typeof body.builtInWeight === "number" && Number.isFinite(body.builtInWeight)) updates.builtInWeight = body.builtInWeight.toString();
    else return NextResponse.json({ error: "builtInWeight must be a number" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [row] = await db.update(machines).set(updates).where(eq(machines.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

// DELETE /api/machines/[id] — history-safe: refuses (409) while logged sets
// reference the machine, so past loads never lose their context. Merge instead
// to move history. exercise_machines links cascade away with the row.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  const [used] = await db.select({ id: setLogs.id }).from(setLogs).where(eq(setLogs.machineId, id)).limit(1);
  if (used) {
    return NextResponse.json(
      { error: "referenced", message: "Logged sets reference this machine — merge it into another instead of deleting." },
      { status: 409 }
    );
  }

  const [row] = await db.delete(machines).where(eq(machines.id, id)).returning({ id: machines.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
