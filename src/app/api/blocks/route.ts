import { NextRequest, NextResponse } from "next/server";
import { listBlocks, getOrCreateBlockLibrary, addDay } from "@/lib/programs";

// Blocks are the block-library program's days, so their contents are edited
// through the existing /api/program-days/[id] and /api/program-exercises/[id]
// routes — this file only lists blocks and creates a new (empty) one.
export async function GET() {
  const blocks = await listBlocks();
  return NextResponse.json(blocks);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = body?.name;
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const lib = await getOrCreateBlockLibrary();
  const day = await addDay(lib.id, name.trim());
  return NextResponse.json(day, { status: 201 });
}
