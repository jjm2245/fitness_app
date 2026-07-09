import { NextRequest, NextResponse } from "next/server";
import { renameProgram, setActiveProgram, deleteProgram, getProgramWithDays } from "@/lib/programs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = await getProgramWithDays(Number(id));
  if (!program) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(program);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const programId = Number(id);
  const body = await request.json().catch(() => null);

  if (typeof body?.splitType === "string" && body.splitType.trim() !== "") {
    await renameProgram(programId, body.splitType.trim());
  }
  if (body?.active === true) {
    await setActiveProgram(programId);
  }

  const program = await getProgramWithDays(programId);
  return NextResponse.json(program);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteProgram(Number(id));
  return NextResponse.json({ ok: true });
}
