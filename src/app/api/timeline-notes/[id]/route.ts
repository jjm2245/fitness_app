import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { timelineNotes } from "@/db/schema";
import { validateNote, type NoteBody } from "../route";

// PATCH/DELETE /api/timeline-notes/[id] — correct or remove one annotation.
//
// Every field is editable, because every one of them is a judgement call made
// in the moment: the start date gets mistyped, the end date gets set too early,
// the text reads differently a week later.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as NoteBody;

  // The existing row is needed so a partial edit still validates the ORDER of
  // the two dates — setting only an end must be checked against the stored
  // start, not against nothing.
  const [existing] = await db
    .select({ startDate: timelineNotes.startDate, endDate: timelineNotes.endDate })
    .from(timelineNotes)
    .where(eq(timelineNotes.id, rowId));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const v = validateNote(body, existing);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
  if (Object.keys(v).length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

  const [row] = await db.update(timelineNotes).set(v).where(eq(timelineNotes.id, rowId)).returning();
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // No delete-guard ceremony: nothing references these rows, so removing one
  // orphans nothing. The confirmation lives in the UI, where the note is
  // visible — a guard here would be theatre.
  const [row] = await db.delete(timelineNotes).where(eq(timelineNotes.id, rowId)).returning({ id: timelineNotes.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: row.id });
}
