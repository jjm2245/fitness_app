import { NextRequest, NextResponse } from "next/server";
import { renameDay, deleteDay } from "@/lib/programs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const name = body?.name;
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const day = await renameDay(Number(id), name.trim());
  return NextResponse.json(day);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteDay(Number(id));
  return NextResponse.json({ ok: true });
}
