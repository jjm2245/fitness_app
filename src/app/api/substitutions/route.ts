import { NextRequest, NextResponse } from "next/server";
import { loadAllExerciseTags, loadActiveInjuryStructures } from "@/lib/coreAdapters";
import { findSubstitutionCandidates, rankSubstitutionCandidates } from "@/core/substitution";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const exerciseId = searchParams.get("exerciseId");
  const equipmentParam = searchParams.get("equipment"); // comma-separated available equipment

  if (!exerciseId) {
    return NextResponse.json({ error: "exerciseId is required" }, { status: 400 });
  }

  const allExercises = await loadAllExerciseTags();
  const original = allExercises.find((e) => e.id === exerciseId);
  if (!original) {
    return NextResponse.json({ error: "Unknown exerciseId" }, { status: 404 });
  }

  const availableEquipment = equipmentParam
    ? equipmentParam.split(",").map((e) => e.trim())
    : Array.from(new Set(allExercises.flatMap((e) => e.equipmentRequired)));

  const activeInjuryStructures = await loadActiveInjuryStructures();

  const candidates = findSubstitutionCandidates({
    original,
    pool: allExercises,
    availableEquipment,
    activeInjuryStructures,
  });
  const ranked = rankSubstitutionCandidates(original, candidates);

  return NextResponse.json(
    ranked.map((r) => ({ id: r.exercise.id, score: r.score }))
  );
}
