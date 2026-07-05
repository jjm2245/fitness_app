import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises } from "@/db/schema";
import { loadSetLogInputsForExercise } from "@/lib/coreAdapters";
import { resolveProgressionSignal, toSessionSummaries } from "@/core/machineTracking";
import { nextStallIntervention } from "@/core/stallBuster";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const exerciseId = searchParams.get("exerciseId");
  const machineId = searchParams.get("machineId"); // omit for portable free-weight/bodyweight lifts
  const repRangeMax = Number(searchParams.get("repRangeMax") ?? "12");
  const targetRir = Number(searchParams.get("targetRir") ?? "2");
  const stallSessionThreshold = Number(searchParams.get("stallSessionThreshold") ?? "3");

  if (!exerciseId) {
    return NextResponse.json({ error: "exerciseId is required" }, { status: 400 });
  }

  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));
  if (!exercise) {
    return NextResponse.json({ error: "Unknown exerciseId" }, { status: 404 });
  }

  const sets = await loadSetLogInputsForExercise(exerciseId);
  const result = resolveProgressionSignal(sets, machineId, {
    repRangeMax,
    targetRir,
    stallSessionThreshold,
    loadType: exercise.loadType,
  });

  if (result.status === "resolved" && result.signal.type === "true_stall") {
    const laneSessions = toSessionSummaries(sets.filter((s) => s.machineId === machineId));
    const intervention = nextStallIntervention(laneSessions, targetRir, stallSessionThreshold);
    return NextResponse.json({ ...result, intervention });
  }

  return NextResponse.json(result);
}
