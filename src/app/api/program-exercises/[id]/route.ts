import { NextRequest, NextResponse } from "next/server";
import { updateProgramExercise, removeProgramExercise, type ProgramExerciseUpdate } from "@/lib/programs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const EFFORTS = new Set(["more_in_me", "near_failure", "to_failure"]);
  const updates: ProgramExerciseUpdate = {};
  if (typeof body?.targetSets === "number" || body?.targetSets === null) updates.targetSets = body.targetSets;
  if (typeof body?.repRange === "string" || body?.repRange === null) updates.repRange = body.repRange;
  if (body?.effortTarget === null || (typeof body?.effortTarget === "string" && EFFORTS.has(body.effortTarget))) updates.effortTarget = body.effortTarget;
  if (typeof body?.rirTarget === "string" || body?.rirTarget === null) updates.rirTarget = body.rirTarget;
  if (typeof body?.dayId === "number") updates.dayId = body.dayId;

  const row = await updateProgramExercise(Number(id), updates);
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeProgramExercise(Number(id));
  return NextResponse.json({ ok: true });
}
