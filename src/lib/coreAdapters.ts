// Maps DB rows (Drizzle) to the deterministic core's plain data types (src/core/*).
// Keeping this conversion in one place is what lets src/core stay DB-agnostic.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { exercises, exerciseMuscles, setLogs, workoutLogs, injuryFlags } from "@/db/schema";
import type { ExerciseTags, MuscleEmphasis, SetLogInput } from "@/core/types";

export async function loadExerciseTags(exerciseId: string): Promise<ExerciseTags | null> {
  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));
  if (!exercise) return null;

  const muscleRows = await db
    .select()
    .from(exerciseMuscles)
    .where(eq(exerciseMuscles.exerciseId, exerciseId));

  return toExerciseTags(exercise, muscleRows);
}

export async function loadAllExerciseTags(): Promise<ExerciseTags[]> {
  const allExercises = await db.select().from(exercises);
  const allMuscleRows = await db.select().from(exerciseMuscles);

  const muscleRowsByExercise = new Map<string, typeof allMuscleRows>();
  for (const row of allMuscleRows) {
    const list = muscleRowsByExercise.get(row.exerciseId) ?? [];
    list.push(row);
    muscleRowsByExercise.set(row.exerciseId, list);
  }

  return allExercises.map((ex) => toExerciseTags(ex, muscleRowsByExercise.get(ex.id) ?? []));
}

function toExerciseTags(
  exercise: typeof exercises.$inferSelect,
  muscleRows: (typeof exerciseMuscles.$inferSelect)[]
): ExerciseTags {
  const muscles: MuscleEmphasis[] = muscleRows.map((m) => ({
    muscle: m.muscle,
    role: m.role,
    emphasis: Number(m.emphasis),
  }));

  return {
    id: exercise.id,
    movementPattern: exercise.movementPattern,
    muscles,
    equipmentRequired: exercise.equipmentRequired,
    affectedStructures: exercise.affectedStructures,
    skillLevel: exercise.skillLevel,
  };
}

export async function loadActiveInjuryStructures(): Promise<string[]> {
  const rows = await db.select().from(injuryFlags).where(eq(injuryFlags.active, true));
  return rows.map((r) => r.structure);
}

export async function loadSetLogInputsForExercise(exerciseId: string): Promise<SetLogInput[]> {
  const rows = await db
    .select({
      exerciseId: setLogs.exerciseId,
      machineId: setLogs.machineId,
      setType: setLogs.setType,
      load: setLogs.load,
      reps: setLogs.reps,
      rir: setLogs.rir,
      date: workoutLogs.date,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(eq(setLogs.exerciseId, exerciseId));

  return rows.map((r) => ({
    exerciseId: r.exerciseId,
    machineId: r.machineId,
    date: r.date,
    setType: r.setType,
    load: Number(r.load),
    reps: r.reps,
    rir: r.rir === null ? null : Number(r.rir),
  }));
}

export async function loadAllSetLogInputs(exerciseIds: string[]): Promise<SetLogInput[]> {
  if (exerciseIds.length === 0) return [];
  const rows = await db
    .select({
      exerciseId: setLogs.exerciseId,
      machineId: setLogs.machineId,
      setType: setLogs.setType,
      load: setLogs.load,
      reps: setLogs.reps,
      rir: setLogs.rir,
      date: workoutLogs.date,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .where(and(inArray(setLogs.exerciseId, exerciseIds)));

  return rows.map((r) => ({
    exerciseId: r.exerciseId,
    machineId: r.machineId,
    date: r.date,
    setType: r.setType,
    load: Number(r.load),
    reps: r.reps,
    rir: r.rir === null ? null : Number(r.rir),
  }));
}
