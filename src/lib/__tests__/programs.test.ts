import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  listPrograms,
  getProgram,
  getActiveProgram,
  createProgram,
  renameProgram,
  setActiveProgram,
  deleteProgram,
  getProgramWithDays,
  addDay,
  renameDay,
  deleteDay,
  moveDay,
  addExerciseToDay,
  updateProgramExercise,
  removeProgramExercise,
  moveProgramExercise,
  seedProgramFromRoutine,
  getOrCreateBlockLibrary,
  listBlocks,
  DEFAULT_PROGRAM_EXERCISE_TARGETS,
} from "../programs";

// Integration tests against the real local Postgres instance (same pattern as
// src/db/__tests__/seed.test.ts) — requires the seed loader to have already
// run (`npm run db:seed`) so real exercise ids exist to reference.

const EXERCISE_A = "machine_leg_extension";
const EXERCISE_B = "deadlift";

const createdProgramIds: number[] = [];
let originalActiveProgramId: number | null = null;

beforeAll(async () => {
  const active = await getActiveProgram();
  originalActiveProgramId = active?.id ?? null;
});

afterEach(async () => {
  for (const id of createdProgramIds.splice(0)) {
    await deleteProgram(id);
  }
  // Restore whichever program was active before this test file ran, since
  // setActiveProgram() deactivates whatever else was active.
  if (originalActiveProgramId) {
    const stillActive = await getActiveProgram();
    if (stillActive?.id !== originalActiveProgramId) {
      await setActiveProgram(originalActiveProgramId);
    }
  }
});

afterAll(async () => {
  if (originalActiveProgramId) {
    const stillActive = await getActiveProgram();
    if (stillActive?.id !== originalActiveProgramId) {
      await setActiveProgram(originalActiveProgramId);
    }
  }
});

async function makeProgram(splitType: string, active = false) {
  const program = await createProgram(splitType, active);
  createdProgramIds.push(program.id);
  return program;
}

describe("programs CRUD", () => {
  it("creates and lists a program", async () => {
    const program = await makeProgram("test_program_create");
    const all = await listPrograms();
    expect(all.some((p) => p.id === program.id)).toBe(true);
  });

  it("gets a program by id", async () => {
    const program = await makeProgram("test_program_get");
    const fetched = await getProgram(program.id);
    expect(fetched?.splitType).toBe("test_program_get");
  });

  it("excludes the block library from listPrograms but exposes it via listBlocks", async () => {
    const lib = await getOrCreateBlockLibrary();
    expect(lib.isBlockLibrary).toBe(true);

    const programsList = await listPrograms();
    expect(programsList.some((p) => p.id === lib.id)).toBe(false); // hidden from the switcher

    // A block is just one of the library's days.
    const block = await addDay(lib.id, "test_block_abs");
    await addExerciseToDay(block.id, EXERCISE_A);
    const blocks = await listBlocks();
    const seen = blocks.find((b) => b.id === block.id);
    expect(seen).toBeDefined();
    expect(seen?.exercises[0].exerciseId).toBe(EXERCISE_A);

    await deleteDay(block.id); // cleanup (leave library row; it's a singleton)
  });

  it("renames a program", async () => {
    const program = await makeProgram("test_program_before_rename");
    const renamed = await renameProgram(program.id, "test_program_after_rename");
    expect(renamed.splitType).toBe("test_program_after_rename");
  });

  it("setActiveProgram makes exactly one program active", async () => {
    const a = await makeProgram("test_program_active_a", true);
    const b = await makeProgram("test_program_active_b", false);

    await setActiveProgram(b.id);

    const refreshedA = await getProgram(a.id);
    const refreshedB = await getProgram(b.id);
    expect(refreshedA?.active).toBe(false);
    expect(refreshedB?.active).toBe(true);
  });

  it("deleting a program cascades to its days and exercises", async () => {
    const program = await makeProgram("test_program_delete_cascade");
    const day = await addDay(program.id, "test_day");
    await addExerciseToDay(day.id, EXERCISE_A);

    await deleteProgram(program.id);
    createdProgramIds.splice(createdProgramIds.indexOf(program.id), 1); // already deleted

    const full = await getProgramWithDays(program.id);
    expect(full).toBeNull();
  });
});

describe("days", () => {
  it("adds days with increasing order_index", async () => {
    const program = await makeProgram("test_program_days_order");
    const day1 = await addDay(program.id, "Day 1");
    const day2 = await addDay(program.id, "Day 2");
    expect(day1.orderIndex).toBe(0);
    expect(day2.orderIndex).toBe(1);
  });

  it("renames a day", async () => {
    const program = await makeProgram("test_program_day_rename");
    const day = await addDay(program.id, "Old Name");
    const renamed = await renameDay(day.id, "New Name");
    expect(renamed.name).toBe("New Name");
  });

  it("deleting a day cascades to its program_exercises", async () => {
    const program = await makeProgram("test_program_day_delete_cascade");
    const day = await addDay(program.id, "Day");
    await addExerciseToDay(day.id, EXERCISE_A);

    await deleteDay(day.id);

    const full = await getProgramWithDays(program.id);
    expect(full?.days).toHaveLength(0);
  });

  it("moves a day up and down, swapping order_index with its neighbor", async () => {
    const program = await makeProgram("test_program_day_move");
    await addDay(program.id, "Day 1");
    const day2 = await addDay(program.id, "Day 2");

    await moveDay(day2.id, "up");

    const full = await getProgramWithDays(program.id);
    const names = full?.days.map((d) => d.name);
    expect(names).toEqual(["Day 2", "Day 1"]);

    // moving the (now) first day up again is a no-op — already at the top
    await moveDay(day2.id, "up");
    const full2 = await getProgramWithDays(program.id);
    expect(full2?.days.map((d) => d.name)).toEqual(["Day 2", "Day 1"]);
  });
});

describe("program exercises", () => {
  it("adds an exercise with default targets when no overrides given", async () => {
    const program = await makeProgram("test_program_ex_defaults");
    const day = await addDay(program.id, "Day");
    const row = await addExerciseToDay(day.id, EXERCISE_A);

    expect(row.targetSets).toBe(DEFAULT_PROGRAM_EXERCISE_TARGETS.targetSets);
    expect(row.repRange).toBe(DEFAULT_PROGRAM_EXERCISE_TARGETS.repRange);
    expect(row.rirTarget).toBe(DEFAULT_PROGRAM_EXERCISE_TARGETS.rirTarget);
  });

  it("allows arbitrary rep-range overrides, not just the default literal", async () => {
    const program = await makeProgram("test_program_ex_overrides");
    const day = await addDay(program.id, "Day");
    const row = await addExerciseToDay(day.id, EXERCISE_A, {
      targetSets: 5,
      repRange: "5-8",
      rirTarget: "1",
    });

    expect(row.targetSets).toBe(5);
    expect(row.repRange).toBe("5-8");
    expect(row.rirTarget).toBe("1");
  });

  it("updates per-exercise targets independently (not a blanket value)", async () => {
    const program = await makeProgram("test_program_ex_update");
    const day = await addDay(program.id, "Day");
    const rowA = await addExerciseToDay(day.id, EXERCISE_A);
    const rowB = await addExerciseToDay(day.id, EXERCISE_B);

    await updateProgramExercise(rowA.id, { targetSets: 4, repRange: "10-15" });

    const full = await getProgramWithDays(program.id);
    const exA = full?.days[0].exercises.find((e) => e.id === rowA.id);
    const exB = full?.days[0].exercises.find((e) => e.id === rowB.id);
    expect(exA?.targetSets).toBe(4);
    expect(exA?.repRange).toBe("10-15");
    expect(exB?.targetSets).toBe(DEFAULT_PROGRAM_EXERCISE_TARGETS.targetSets);
  });

  it("removes a program exercise", async () => {
    const program = await makeProgram("test_program_ex_remove");
    const day = await addDay(program.id, "Day");
    const row = await addExerciseToDay(day.id, EXERCISE_A);

    await removeProgramExercise(row.id);

    const full = await getProgramWithDays(program.id);
    expect(full?.days[0].exercises).toHaveLength(0);
  });

  it("moves an exercise up and down within a day", async () => {
    const program = await makeProgram("test_program_ex_move");
    const day = await addDay(program.id, "Day");
    const rowA = await addExerciseToDay(day.id, EXERCISE_A);
    const rowB = await addExerciseToDay(day.id, EXERCISE_B);

    await moveProgramExercise(rowB.id, "up");

    const full = await getProgramWithDays(program.id);
    const ids = full?.days[0].exercises.map((e) => e.id);
    expect(ids).toEqual([rowB.id, rowA.id]);
  });
});

describe("seedProgramFromRoutine", () => {
  it("builds a program with days and exercises via the same primitives as the editor", async () => {
    const program = await seedProgramFromRoutine("test_program_seed_routine", [
      { name: "day_one", exercises: [{ exerciseId: EXERCISE_A, conditioningOnly: false }] },
      { name: "day_two", exercises: [{ exerciseId: EXERCISE_B, conditioningOnly: false }] },
    ]);
    createdProgramIds.push(program.id);

    const full = await getProgramWithDays(program.id);
    expect(full?.days.map((d) => d.name)).toEqual(["day_one", "day_two"]);
    expect(full?.days[0].exercises[0].exerciseId).toBe(EXERCISE_A);
    expect(full?.days[0].exercises[0].targetSets).toBe(DEFAULT_PROGRAM_EXERCISE_TARGETS.targetSets);
  });

  it("gives conditioning-only exercises 1 set and no rep range", async () => {
    const program = await seedProgramFromRoutine("test_program_seed_conditioning", [
      {
        name: "cardio",
        exercises: [{ exerciseId: "treadmill_incline_walk", conditioningOnly: true }],
      },
    ]);
    createdProgramIds.push(program.id);

    const full = await getProgramWithDays(program.id);
    const ex = full?.days[0].exercises[0];
    expect(ex?.targetSets).toBe(1);
    expect(ex?.repRange).toBeNull();
    expect(ex?.rirTarget).toBeNull();
  });
});
