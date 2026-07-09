import { NextRequest, NextResponse } from "next/server";
import { addExerciseToDay } from "@/lib/programs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const exerciseId = body?.exerciseId;
  if (typeof exerciseId !== "string" || exerciseId.trim() === "") {
    return NextResponse.json({ error: "exerciseId is required" }, { status: 400 });
  }

  const overrides: { targetSets?: number; repRange?: string | null; rirTarget?: string | null } = {};
  if (typeof body?.targetSets === "number") overrides.targetSets = body.targetSets;
  if (typeof body?.repRange === "string" || body?.repRange === null) overrides.repRange = body.repRange;
  if (typeof body?.rirTarget === "string" || body?.rirTarget === null) overrides.rirTarget = body.rirTarget;

  const row = await addExerciseToDay(Number(id), exerciseId, overrides);
  return NextResponse.json(row, { status: 201 });
}
