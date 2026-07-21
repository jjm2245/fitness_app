import { NextRequest, NextResponse } from "next/server";
import { reorderProgramDays } from "@/lib/programs";

// POST /api/programs/[id]/days/reorder { orderedIds: number[] }
// Commits a whole ordering of a program's days at once (the Organize-order
// modal) — contiguous order_index 0..n-1, scoped to this program.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : null;
  if (!orderedIds || !orderedIds.every((n: unknown) => typeof n === "number")) {
    return NextResponse.json({ error: "orderedIds (number[]) is required" }, { status: 400 });
  }
  try {
    await reorderProgramDays(Number(id), orderedIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "reorder failed" }, { status: 409 });
  }
}
