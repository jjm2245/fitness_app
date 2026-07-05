import { NextRequest, NextResponse } from "next/server";
import { loadSetLogInputsForExercise } from "@/lib/coreAdapters";
import { resolveProgressionSignal } from "@/core/machineTracking";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const exerciseId = searchParams.get("exerciseId");
  const machineId = searchParams.get("machineId"); // omit for portable free-weight/bodyweight lifts
  const repRangeMax = Number(searchParams.get("repRangeMax") ?? "12");
  const targetRir = Number(searchParams.get("targetRir") ?? "2");

  if (!exerciseId) {
    return NextResponse.json({ error: "exerciseId is required" }, { status: 400 });
  }

  const sets = await loadSetLogInputsForExercise(exerciseId);
  const result = resolveProgressionSignal(sets, machineId, { repRangeMax, targetRir });

  return NextResponse.json(result);
}
