import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { machines } from "@/db/schema";

// PATCH /api/machines/[id] { notes } — edit a machine's note (Part 3c). The id
// is the user's label and is referenced by logged sets, so it isn't renamed
// here; the editable field is the free-text note (brand, location, etc.).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body?.notes === undefined) return NextResponse.json({ error: "notes is required" }, { status: 400 });
  const notes = typeof body.notes === "string" && body.notes.trim() !== "" ? body.notes.trim() : null;

  const [row] = await db
    .update(machines)
    .set({ notes })
    .where(eq(machines.id, decodeURIComponent(id)))
    .returning({ id: machines.id, notes: machines.notes });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
