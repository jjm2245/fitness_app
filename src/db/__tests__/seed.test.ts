import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { exercises, exerciseMuscles, exerciseSubstitutions } from "../schema";

// Integration test: requires the seed loader to have already been run against
// DATABASE_URL (`npm run db:seed`). Verifies tags survive the JSON -> DB round trip.
describe("seed loader", () => {
  it("preserves the back-safety tag on the deadlift", async () => {
    const [deadlift] = await db.select().from(exercises).where(eq(exercises.id, "deadlift"));
    expect(deadlift).toBeDefined();
    expect(deadlift.affectedStructures).toContain("lumbar_spine");
    expect(deadlift.portable).toBe(true);
    expect(deadlift.loadType).toBe("free_weight");
  });

  it("preserves fractional emphasis for primary and secondary muscles", async () => {
    const rows = await db
      .select()
      .from(exerciseMuscles)
      .where(eq(exerciseMuscles.exerciseId, "deadlift"));

    const hamstrings = rows.find((r) => r.muscle === "hamstrings");
    const lats = rows.find((r) => r.muscle === "lats");

    expect(hamstrings?.role).toBe("primary");
    expect(Number(hamstrings?.emphasis)).toBe(1);
    expect(lats?.role).toBe("secondary");
    expect(Number(lats?.emphasis)).toBe(0.3);
  });

  it("preserves substitution candidates with back-friendly notes", async () => {
    const subs = await db
      .select()
      .from(exerciseSubstitutions)
      .where(eq(exerciseSubstitutions.exerciseId, "deadlift"));

    expect(subs.length).toBeGreaterThan(0);
    const backFriendly = subs.find((s) => s.note === "preferred if back flares");
    expect(backFriendly).toBeDefined();
  });

  it("loads the 33 curated + 4 split-variant + 4 net-new exercises with tags intact", async () => {
    const all = await db.select().from(exercises);
    // 33 hand-tagged PF nodes + 4 split-out "either/or" variants (Part 2) + 4
    // net-new exercises with a library pairing (Part D: barbell_squat,
    // hack_squat, face_pull, stiff_legged_barbell_deadlift), all
    // source='curated'. Bayesian curl is net-new but source='custom' (no library
    // match). Library exercises are ingested separately and not counted here.
    const curated = all.filter((e) => e.source === "curated");
    expect(curated.length).toBe(41);
    const smithSquat = curated.find((e) => e.id === "smith_squat");
    expect(smithSquat?.equipmentRequired).toEqual(["smith_machine"]);
    expect(smithSquat?.affectedStructures).toContain("lumbar_spine");
    // A split variant exists as its own node with its own tags.
    const dbGoblet = curated.find((e) => e.id === "db_goblet_squat");
    expect(dbGoblet?.loadType).toBe("free_weight");
    expect(dbGoblet?.portable).toBe(true);
    // A net-new exercise is fully tagged (movement pattern set) so it counts.
    const facePull = curated.find((e) => e.id === "face_pull");
    expect(facePull?.movementPattern).toBe("rear_delt_fly");
    const bayesian = all.find((e) => e.id === "bayesian_curl");
    expect(bayesian?.source).toBe("custom");
    expect(bayesian?.movementPattern).toBe("elbow_flexion");
  });
});
