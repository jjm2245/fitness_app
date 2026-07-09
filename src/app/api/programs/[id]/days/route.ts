import { NextRequest, NextResponse } from "next/server";
import { addDay } from "@/lib/programs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const name = body?.name;
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const day = await addDay(Number(id), name.trim());
  return NextResponse.json(day, { status: 201 });
}
