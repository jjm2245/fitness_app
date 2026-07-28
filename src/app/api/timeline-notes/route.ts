import { NextRequest, NextResponse } from "next/server";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { timelineNotes } from "@/db/schema";

// GET/POST /api/timeline-notes — the annotations that explain the periods
// between sessions.
//
// NOT read by src/core/*, and it must stay that way. Unlike `injury_flags`,
// which feeds substitution through `loadActiveInjuryStructures()`, nothing here
// reaches the training engine. These rows explain history; they never change
// what the app suggests.

export interface NoteBody {
  startDate?: unknown;
  endDate?: unknown;
  kind?: unknown;
  notes?: unknown;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validation shared by POST and PATCH. Returns an error string, or the
 *  normalized fields. The date-order check lives HERE so the user gets a
 *  sentence rather than the CHECK constraint's raw violation text. */
export function validateNote(
  body: NoteBody,
  existing?: { startDate: string; endDate: string | null }
): { error: string } | { startDate?: string; endDate?: string | null; kind?: string | null; notes?: string } {
  const out: { startDate?: string; endDate?: string | null; kind?: string | null; notes?: string } = {};

  if (body.startDate !== undefined) {
    const v = typeof body.startDate === "string" ? body.startDate.trim() : "";
    if (!ISO.test(v)) return { error: "Start date must be a real date." };
    out.startDate = v;
  }
  if (body.endDate !== undefined) {
    // Explicit null / empty string = CLEAR IT. Re-opening a note you closed
    // prematurely has to be possible.
    if (body.endDate === null || body.endDate === "") out.endDate = null;
    else {
      const v = typeof body.endDate === "string" ? body.endDate.trim() : "";
      if (!ISO.test(v)) return { error: "End date must be a real date, or empty for still ongoing." };
      out.endDate = v;
    }
  }
  if (body.kind !== undefined) {
    const v = typeof body.kind === "string" ? body.kind.trim() : "";
    out.kind = v === "" ? null : v;
  }
  if (body.notes !== undefined) {
    const v = typeof body.notes === "string" ? body.notes.trim() : "";
    // NOT NULL by design: a timeline note with no text explains nothing.
    if (v === "") return { error: "A note needs some text — the dates alone don't explain anything." };
    out.notes = v;
  }

  // The order check, in words. A raw constraint violation surfacing in the UI
  // would be useless, so it never gets that far.
  const start = out.startDate ?? existing?.startDate;
  const end = out.endDate !== undefined ? out.endDate : existing?.endDate ?? null;
  if (start && end && end < start) {
    return { error: "The end date can't be before the start date." };
  }
  return out;
}

export async function GET() {
  const rows = await db
    .select()
    .from(timelineNotes)
    // Newest first, matching History's own order. Ties broken by id so the
    // sequence is stable across reads.
    .orderBy(desc(timelineNotes.startDate), asc(timelineNotes.id));
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as NoteBody;
  if (body.startDate === undefined) return NextResponse.json({ error: "A note needs a start date." }, { status: 400 });
  if (body.notes === undefined) return NextResponse.json({ error: "A note needs some text." }, { status: 400 });

  const v = validateNote(body);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });

  const [row] = await db
    .insert(timelineNotes)
    .values({ startDate: v.startDate!, endDate: v.endDate ?? null, kind: v.kind ?? null, notes: v.notes! })
    .returning();
  return NextResponse.json(row);
}
