import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  exercises,
  movementPatternEnum,
  setLogs,
  cardioLogs,
  sessionExercises,
  programExercises,
  exerciseSubstitutions,
  formChecks,
} from "@/db/schema";

type MovementPattern = (typeof movementPatternEnum.enumValues)[number];
const PATTERNS = new Set<string>(movementPatternEnum.enumValues);

// PATCH /api/exercises/[id] — update an exercise: assign a movement pattern
// (the "graduation" step of movement-pattern-on-add, Part B — makes it
// substitutable and clears untagged) and/or rename it (custom-exercise
// management, Part 3b). Both are optional; at least one must be present.
// GET /api/exercises/[id] — current metadata for one exercise. The log screen
// uses this to refresh flags like `unilateral` that may have been edited AFTER
// a session's occurrence snapshot was taken (e.g. tagging rotary torso
// unilateral should make historical sets side-editable, not just future ones).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      unilateral: exercises.unilateral,
      untagged: exercises.untagged,
      description: exercises.description,
    })
    .from(exercises)
    .where(eq(exercises.id, id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const updates: { movementPattern?: MovementPattern; untagged?: boolean; name?: string; description?: string | null; unilateral?: boolean; params?: Record<string, unknown> | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };

  // Cardio target params (phase 3.1): the program editor edits an exercise's
  // prescription (duration/incline/speed) here — it's exercise-level, jsonb,
  // no schema change. Accept an object or null (clears the target).
  if (body?.params !== undefined && (body.params === null || (typeof body.params === "object" && !Array.isArray(body.params)))) {
    updates.params = body.params as Record<string, unknown> | null;
  }

  // Unilateral tag — visible + editable per exercise (Part 4). Your edit
  // overrides for your copy; the library value was only ever the default.
  if (typeof body?.unilateral === "boolean") updates.unilateral = body.unilateral;

  if (body?.movementPattern !== undefined) {
    if (typeof body.movementPattern !== "string" || !PATTERNS.has(body.movementPattern)) {
      return NextResponse.json({ error: "Valid movementPattern is required" }, { status: 400 });
    }
    updates.movementPattern = body.movementPattern as MovementPattern;
    updates.untagged = false;
  }

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") return NextResponse.json({ error: "name can't be empty" }, { status: 400 });
    updates.name = name;
  }

  if (body?.description !== undefined) {
    // Optional free text; empty string clears it back to null. Never required.
    const d = typeof body.description === "string" ? body.description.trim() : "";
    updates.description = d === "" ? null : d;
  }

  if (updates.movementPattern === undefined && updates.name === undefined && updates.description === undefined && updates.unilateral === undefined && updates.params === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .update(exercises)
    .set(updates)
    .where(eq(exercises.id, id))
    .returning({
      id: exercises.id,
      name: exercises.name,
      loadType: exercises.loadType,
      portable: exercises.portable,
      conditioningOnly: exercises.conditioningOnly,
      source: exercises.source,
      untagged: exercises.untagged,
      canonicalName: exercises.canonicalName,
      movementPattern: exercises.movementPattern,
      description: exercises.description,
      unilateral: exercises.unilateral,
    });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

// DELETE /api/exercises/[id] — remove an exercise the user no longer wants
// (Part 7). History-safe: if anything references it (logged sets/cardio, a
// performed occurrence, a program slot, a substitution link, or a form check)
// we refuse with 409 and report the counts, so logged history is never silently
// orphaned — the FKs have no cascade and would fail anyway. The caller can keep
// it, or collapse it into another exercise (which re-points history). With no
// references, the delete removes the row (exercise_muscles/exercise_machines
// cascade).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [target] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, id));
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  const [sets, cardio, occ, prog, subs, forms] = await Promise.all([
    count(db.select({ id: setLogs.id }).from(setLogs).where(eq(setLogs.exerciseId, id))),
    count(db.select({ id: cardioLogs.id }).from(cardioLogs).where(eq(cardioLogs.exerciseId, id))),
    count(db.select({ id: sessionExercises.id }).from(sessionExercises).where(eq(sessionExercises.exerciseId, id))),
    count(db.select({ id: programExercises.id }).from(programExercises).where(eq(programExercises.exerciseId, id))),
    count(
      db
        .select({ id: exerciseSubstitutions.id })
        .from(exerciseSubstitutions)
        .where(or(eq(exerciseSubstitutions.exerciseId, id), eq(exerciseSubstitutions.candidateExerciseId, id)))
    ),
    count(db.select({ id: formChecks.id }).from(formChecks).where(eq(formChecks.exerciseId, id))),
  ]);

  const blockedBy = { sets, cardio, occurrences: occ, program: prog, substitutions: subs, formChecks: forms };
  const total = sets + cardio + occ + prog + subs + forms;
  if (total > 0) {
    return NextResponse.json(
      { error: "referenced", message: "This exercise has logged history or is in use — kept to avoid orphaning it. Collapse it into another exercise to move the history first.", blockedBy },
      { status: 409 }
    );
  }

  await db.delete(exercises).where(eq(exercises.id, id));
  return NextResponse.json({ ok: true, deleted: id });
}
