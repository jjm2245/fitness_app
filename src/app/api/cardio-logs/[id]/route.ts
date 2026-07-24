import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cardioLogs } from "@/db/schema";

const EFFORT_VALUES = new Set(["more_in_me", "near_failure", "to_failure"]);
const REST_SOURCES = new Set(["timed", "derived", "user"]);
const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? String(v) : null);

// PATCH /api/cardio-logs/[id] — edit a logged metric entry (mirror of the
// set-logs PATCH: value edits, rest corrections, drop-group assignment).
// Forward-only history is enforced by the caller (the card only patches
// fields the entry already carries); the route just applies what it's sent.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardioId = Number(id);
  if (!Number.isFinite(cardioId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Missing body" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const f of ["durationMin", "incline", "speed", "distance", "level", "load"] as const) {
    if (body[f] !== undefined) updates[f] = num(body[f]);
  }
  if (body.effort !== undefined) {
    updates.effort = body.effort && EFFORT_VALUES.has(body.effort) ? body.effort : null;
  }
  if (body.restSeconds === null || typeof body.restSeconds === "number") updates.restSeconds = body.restSeconds;
  if (body.restSource === null || REST_SOURCES.has(body.restSource)) updates.restSource = body.restSource;
  if (body.dropSetGroup === null || typeof body.dropSetGroup === "string") updates.dropSetGroup = body.dropSetGroup;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [row] = await db.update(cardioLogs).set(updates).where(eq(cardioLogs.id, cardioId)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardioId = Number(id);
  if (!Number.isFinite(cardioId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const [row] = await db.delete(cardioLogs).where(eq(cardioLogs.id, cardioId)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
