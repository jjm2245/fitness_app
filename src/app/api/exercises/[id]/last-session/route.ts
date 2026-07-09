import { NextRequest, NextResponse } from "next/server";
import { loadSetLogInputsForExercise } from "@/lib/coreAdapters";
import { toSessionSummaries } from "@/core/machineTracking";
import { sessionsFromOldestToNewest } from "@/core/progression";

// Previous-session reference for the logging screen ("last time: 50 x 10, 10, 9").
// Scoped to the same machine lane when machineId is given, since machine-bound
// loads aren't comparable across machines (spec §9).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: exerciseId } = await params;
  const { searchParams } = new URL(request.url);
  const machineId = searchParams.get("machineId");

  const allSets = await loadSetLogInputsForExercise(exerciseId);
  const laneSets = allSets.filter((s) => s.machineId === machineId);
  const sessions = sessionsFromOldestToNewest(toSessionSummaries(laneSets));

  const last = sessions[sessions.length - 1];
  if (!last) {
    return NextResponse.json({ session: null });
  }

  return NextResponse.json({
    session: {
      date: last.date,
      sets: last.workingSets.map((s) => ({ load: s.load, reps: s.reps, rir: s.rir })),
    },
  });
}
