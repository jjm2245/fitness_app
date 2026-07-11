import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { setLogs } from "@/db/schema";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const setLogId = Number(id);
  if (!Number.isFinite(setLogId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  const updates: {
    load?: string;
    reps?: number;
    rir?: string | null;
    effort?: "more_in_me" | "near_failure" | "to_failure" | null;
    setType?: "warmup" | "working";
  } = {};
  if (typeof body?.load === "number") updates.load = body.load.toString();
  if (typeof body?.reps === "number") updates.reps = body.reps;
  if (body?.rir === null) updates.rir = null;
  else if (typeof body?.rir === "number") updates.rir = body.rir.toString();
  if (body?.effort === null || body?.effort === "more_in_me" || body?.effort === "near_failure" || body?.effort === "to_failure") {
    updates.effort = body.effort;
  }
  if (body?.setType === "warmup" || body?.setType === "working") updates.setType = body.setType;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const [row] = await db.update(setLogs).set(updates).where(eq(setLogs.id, setLogId)).returning();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const setLogId = Number(id);
  if (!Number.isFinite(setLogId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [row] = await db.delete(setLogs).where(eq(setLogs.id, setLogId)).returning();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
