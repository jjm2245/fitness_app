import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  exercises,
  setLogs,
  cardioLogs,
  sessionExercises,
  programExercises,
  exerciseSubstitutions,
  formChecks,
} from "@/db/schema";

// POST /api/exercises/[id]/collapse { targetId } — collapse a redundant custom
// exercise into an existing library entry (Part 3b). ALL logged history and
// references are re-pointed from the custom id to the target id first, then the
// custom row is deleted — so nothing is orphaned (the stable-id discipline the
// user called out). Idempotent-ish: re-pointing an already-repointed id is a
// no-op; deleting an already-gone custom returns not-found.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  if (!targetId) return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  if (targetId === id) return NextResponse.json({ error: "targetId must differ" }, { status: 400 });

  const result = await db.transaction(async (tx) => {
    const [custom] = await tx.select().from(exercises).where(eq(exercises.id, id));
    if (!custom) return { error: "not_found" as const };
    const [target] = await tx.select({ id: exercises.id, name: exercises.name }).from(exercises).where(eq(exercises.id, targetId));
    if (!target) return { error: "target_not_found" as const };

    // Re-point every reference to the custom id → the library id.
    await tx.update(setLogs).set({ exerciseId: targetId }).where(eq(setLogs.exerciseId, id));
    await tx.update(cardioLogs).set({ exerciseId: targetId }).where(eq(cardioLogs.exerciseId, id));
    await tx.update(sessionExercises).set({ exerciseId: targetId }).where(eq(sessionExercises.exerciseId, id));
    await tx.update(programExercises).set({ exerciseId: targetId }).where(eq(programExercises.exerciseId, id));
    await tx.update(exerciseSubstitutions).set({ exerciseId: targetId }).where(eq(exerciseSubstitutions.exerciseId, id));
    await tx.update(exerciseSubstitutions).set({ candidateExerciseId: targetId }).where(eq(exerciseSubstitutions.candidateExerciseId, id));
    await tx.update(formChecks).set({ exerciseId: targetId }).where(eq(formChecks.exerciseId, id));

    // Now unreferenced — delete the custom (exercise_muscles cascade off it).
    await tx.delete(exercises).where(eq(exercises.id, id));
    return { ok: true as const, targetId, targetName: target.name };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
  }
  return NextResponse.json(result);
}
