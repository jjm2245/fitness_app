import { NextRequest, NextResponse } from "next/server";
import { moveDay } from "@/lib/programs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const direction = body?.direction;
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "direction must be 'up' or 'down'" }, { status: 400 });
  }

  await moveDay(Number(id), direction);
  return NextResponse.json({ ok: true });
}
