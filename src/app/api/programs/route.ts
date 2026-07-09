import { NextRequest, NextResponse } from "next/server";
import { listPrograms, createProgram } from "@/lib/programs";

export async function GET() {
  const rows = await listPrograms();
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const splitType = body?.splitType;
  if (typeof splitType !== "string" || splitType.trim() === "") {
    return NextResponse.json({ error: "splitType is required" }, { status: 400 });
  }

  const program = await createProgram(splitType.trim(), Boolean(body?.active));
  return NextResponse.json(program, { status: 201 });
}
