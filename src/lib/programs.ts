import "dotenv/config";
import { and, eq, gt, lt, asc, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { programs, programDays, programExercises, exercises } from "@/db/schema";

// Spec §7a: a program is data the user owns, not app structure. These are the
// only read/write paths for programs/program_days/program_exercises — the
// editor API routes and the seed script both call into this file so there is
// exactly one code path, not a separate "seeded default" special case.

export interface ProgramExerciseTargets {
  targetSets: number;
  repRange: string | null;
  rirTarget: string | null;
}

// Generic novice pre-fill (spec §1) for a newly added exercise. This is a
// *suggested starting value*, never a policy the engine reads — target_sets/
// rep_range/rir_target are freely editable per exercise once added.
export const DEFAULT_PROGRAM_EXERCISE_TARGETS: ProgramExerciseTargets = {
  targetSets: 3,
  repRange: "8-12",
  rirTarget: "2",
};

export type Program = typeof programs.$inferSelect;
export type ProgramDay = typeof programDays.$inferSelect;
export type ProgramExerciseRow = typeof programExercises.$inferSelect;

export interface ProgramDayWithExercises extends ProgramDay {
  exercises: Array<
    ProgramExerciseRow & {
      exerciseName: string;
      loadType: string;
      portable: boolean;
      conditioningOnly: boolean;
      params: unknown;
      source: string;
      untagged: boolean;
    }
  >;
}

export interface ProgramWithDays extends Program {
  days: ProgramDayWithExercises[];
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export async function listPrograms(): Promise<Program[]> {
  return db
    .select()
    .from(programs)
    .where(eq(programs.isBlockLibrary, false))
    .orderBy(desc(programs.active), asc(programs.id));
}

export async function getProgram(id: number): Promise<Program | null> {
  const [row] = await db.select().from(programs).where(eq(programs.id, id));
  return row ?? null;
}

export async function getActiveProgram(): Promise<Program | null> {
  const [row] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.active, true), eq(programs.isBlockLibrary, false)));
  return row ?? null;
}

// The block library is a single hidden program whose days are the reusable
// blocks. Created lazily on first use so nothing depends on seed order.
const BLOCK_LIBRARY_SPLIT = "__block_library__";

export async function getOrCreateBlockLibrary(): Promise<Program> {
  const [existing] = await db.select().from(programs).where(eq(programs.isBlockLibrary, true));
  if (existing) return existing;
  const [row] = await db
    .insert(programs)
    .values({ splitType: BLOCK_LIBRARY_SPLIT, active: false, isBlockLibrary: true })
    .returning();
  return row;
}

/** All reusable blocks (the block-library program's days, with their exercises). */
export async function listBlocks(): Promise<ProgramDayWithExercises[]> {
  const lib = await getOrCreateBlockLibrary();
  const full = await getProgramWithDays(lib.id);
  return full?.days ?? [];
}

export async function createProgram(splitType: string, active = false): Promise<Program> {
  return db.transaction(async (tx) => {
    if (active) {
      await tx.update(programs).set({ active: false }).where(eq(programs.active, true));
    }
    const [row] = await tx.insert(programs).values({ splitType, active }).returning();
    return row;
  });
}

export async function renameProgram(id: number, splitType: string): Promise<Program> {
  const [row] = await db
    .update(programs)
    .set({ splitType, updatedAt: new Date() })
    .where(eq(programs.id, id))
    .returning();
  return row;
}

export async function setActiveProgram(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(programs).set({ active: false }).where(eq(programs.active, true));
    await tx.update(programs).set({ active: true, updatedAt: new Date() }).where(eq(programs.id, id));
  });
}

export async function deleteProgram(id: number): Promise<void> {
  await db.delete(programs).where(eq(programs.id, id));
}

export async function getProgramWithDays(id: number): Promise<ProgramWithDays | null> {
  const program = await getProgram(id);
  if (!program) return null;

  const days = await db
    .select()
    .from(programDays)
    .where(eq(programDays.programId, id))
    .orderBy(asc(programDays.orderIndex));

  const dayIds = days.map((d) => d.id);
  const exerciseRows = dayIds.length
    ? await db
        .select({
          id: programExercises.id,
          dayId: programExercises.dayId,
          exerciseId: programExercises.exerciseId,
          targetSets: programExercises.targetSets,
          repRange: programExercises.repRange,
          rirTarget: programExercises.rirTarget,
          orderIndex: programExercises.orderIndex,
          exerciseName: exercises.name,
          loadType: exercises.loadType,
          portable: exercises.portable,
          conditioningOnly: exercises.conditioningOnly,
          params: exercises.params,
          source: exercises.source,
          untagged: exercises.untagged,
        })
        .from(programExercises)
        .innerJoin(exercises, eq(programExercises.exerciseId, exercises.id))
        .where(inArray(programExercises.dayId, dayIds))
        .orderBy(asc(programExercises.orderIndex))
    : [];

  const exercisesByDay = new Map<number, typeof exerciseRows>();
  for (const row of exerciseRows) {
    const list = exercisesByDay.get(row.dayId) ?? [];
    list.push(row);
    exercisesByDay.set(row.dayId, list);
  }

  return {
    ...program,
    days: days.map((day) => ({
      ...day,
      exercises: exercisesByDay.get(day.id) ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export async function addDay(programId: number, name: string): Promise<ProgramDay> {
  const existing = await db
    .select({ orderIndex: programDays.orderIndex })
    .from(programDays)
    .where(eq(programDays.programId, programId))
    .orderBy(desc(programDays.orderIndex))
    .limit(1);
  const nextOrder = existing.length ? existing[0].orderIndex + 1 : 0;

  const [row] = await db.insert(programDays).values({ programId, name, orderIndex: nextOrder }).returning();
  return row;
}

export async function renameDay(dayId: number, name: string): Promise<ProgramDay> {
  const [row] = await db.update(programDays).set({ name }).where(eq(programDays.id, dayId)).returning();
  return row;
}

export async function deleteDay(dayId: number): Promise<void> {
  await db.delete(programDays).where(eq(programDays.id, dayId));
}

export async function moveDay(dayId: number, direction: "up" | "down"): Promise<void> {
  const [day] = await db.select().from(programDays).where(eq(programDays.id, dayId));
  if (!day) return;

  const comparator = direction === "up" ? lt : gt;
  const orderBy = direction === "up" ? desc(programDays.orderIndex) : asc(programDays.orderIndex);

  const [neighbor] = await db
    .select()
    .from(programDays)
    .where(and(eq(programDays.programId, day.programId), comparator(programDays.orderIndex, day.orderIndex)))
    .orderBy(orderBy)
    .limit(1);

  if (!neighbor) return; // already at the top/bottom

  await db.transaction(async (tx) => {
    await tx.update(programDays).set({ orderIndex: day.orderIndex }).where(eq(programDays.id, neighbor.id));
    await tx.update(programDays).set({ orderIndex: neighbor.orderIndex }).where(eq(programDays.id, day.id));
  });
}

// ---------------------------------------------------------------------------
// Program exercises
// ---------------------------------------------------------------------------

export async function addExerciseToDay(
  dayId: number,
  exerciseId: string,
  overrides: Partial<ProgramExerciseTargets> = {}
): Promise<ProgramExerciseRow> {
  const existing = await db
    .select({ orderIndex: programExercises.orderIndex })
    .from(programExercises)
    .where(eq(programExercises.dayId, dayId))
    .orderBy(desc(programExercises.orderIndex))
    .limit(1);
  const nextOrder = existing.length ? existing[0].orderIndex + 1 : 0;

  const targets: ProgramExerciseTargets = { ...DEFAULT_PROGRAM_EXERCISE_TARGETS, ...overrides };

  const [row] = await db
    .insert(programExercises)
    .values({
      dayId,
      exerciseId,
      targetSets: targets.targetSets,
      repRange: targets.repRange,
      rirTarget: targets.rirTarget,
      orderIndex: nextOrder,
    })
    .returning();
  return row;
}

export interface ProgramExerciseUpdate {
  targetSets?: number;
  repRange?: string | null;
  rirTarget?: string | null;
  dayId?: number;
}

export async function updateProgramExercise(
  id: number,
  updates: ProgramExerciseUpdate
): Promise<ProgramExerciseRow> {
  const [row] = await db.update(programExercises).set(updates).where(eq(programExercises.id, id)).returning();
  return row;
}

export async function removeProgramExercise(id: number): Promise<void> {
  await db.delete(programExercises).where(eq(programExercises.id, id));
}

export async function moveProgramExercise(id: number, direction: "up" | "down"): Promise<void> {
  const [row] = await db.select().from(programExercises).where(eq(programExercises.id, id));
  if (!row) return;

  const comparator = direction === "up" ? lt : gt;
  const orderBy = direction === "up" ? desc(programExercises.orderIndex) : asc(programExercises.orderIndex);

  const [neighbor] = await db
    .select()
    .from(programExercises)
    .where(and(eq(programExercises.dayId, row.dayId), comparator(programExercises.orderIndex, row.orderIndex)))
    .orderBy(orderBy)
    .limit(1);

  if (!neighbor) return; // already at the top/bottom

  await db.transaction(async (tx) => {
    await tx
      .update(programExercises)
      .set({ orderIndex: row.orderIndex })
      .where(eq(programExercises.id, neighbor.id));
    await tx.update(programExercises).set({ orderIndex: neighbor.orderIndex }).where(eq(programExercises.id, row.id));
  });
}

// ---------------------------------------------------------------------------
// Seeding — builds a program from the seed's routine using the exact same
// primitives as the editor (createProgram/addDay/addExerciseToDay), so the
// initial PPL is not a bespoke hardcoded policy — see DECISIONS.md.
// ---------------------------------------------------------------------------

export interface SeedRoutineExercise {
  exerciseId: string;
  conditioningOnly: boolean;
}

export interface SeedRoutineDay {
  name: string;
  exercises: SeedRoutineExercise[];
}

export async function seedProgramFromRoutine(splitType: string, days: SeedRoutineDay[]): Promise<Program> {
  const program = await createProgram(splitType, true);

  for (const day of days) {
    const dayRow = await addDay(program.id, day.name);
    for (const ex of day.exercises) {
      await addExerciseToDay(
        dayRow.id,
        ex.exerciseId,
        ex.conditioningOnly ? { targetSets: 1, repRange: null, rirTarget: null } : {}
      );
    }
  }

  return program;
}
