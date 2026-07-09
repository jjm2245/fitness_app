import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises } from "@/db/schema";
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

  const candidateIds = ranked.map((r) => r.exercise.id);
  const details = candidateIds.length
    ? await db
        .select({
          id: exercises.id,
          name: exercises.name,
          loadType: exercises.loadType,
          portable: exercises.portable,
        })
        .from(exercises)
        .where(inArray(exercises.id, candidateIds))
    : [];
  const detailsById = new Map(details.map((d) => [d.id, d]));

  return NextResponse.json(
    ranked.map((r) => ({
      id: r.exercise.id,
      score: r.score,
      name: detailsById.get(r.exercise.id)?.name ?? r.exercise.id,
      loadType: detailsById.get(r.exercise.id)?.loadType,
      portable: detailsById.get(r.exercise.id)?.portable,
      // preserves weekly stimulus, not the load number (spec §8) — the swap UI
      // keeps the original program-exercise's target sets/rep-range/RIR as-is.
    }))
  );
}
