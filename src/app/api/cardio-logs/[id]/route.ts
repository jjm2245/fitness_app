import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cardioLogs } from "@/db/schema";

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
