// Server-side loaders shared by the /api/stats/* routes. Queries only —
// every rule (figures, deltas, PRs, lane modes) lives in src/lib/statsShape.ts
// and src/lib/prs.ts, where it is unit-tested.
//
// Session identity is workout_logs.ID. The last-session route's date-grouping
// (which would merge two sessions logged on one calendar day) is exactly the
// trap this module exists not to repeat: rows are ordered (date, id) and
// grouped by id downstream.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { equipment, equipmentComparability, exercises, setLogs, workoutLogs } from "@/db/schema";
import { laneKey } from "@/lib/equipment";
import { PORTABLE_LANE, type StatSet } from "@/lib/statsShape";

export interface StatRow extends StatSet {
  exerciseId: string;
  exerciseName: string;
  workoutLogId: number;
  date: string;
  /** laneKey() from src/lib/equipment — unit id, "type:unspecified", or
   *  "portable" (the null lane, keyed for grouping). Never re-derived. */
  lane: string;
  hasUnit: boolean;
}

// Pure display/grouping helpers live in statsShape (testable without a db
// client); re-exported here so the routes keep one import surface.
export { PORTABLE_LANE, laneLabel } from "@/lib/statsShape";

export async function loadStatRows(exerciseId?: string): Promise<StatRow[]> {
  const base = db
    .select({
      id: setLogs.id,
      setIndex: setLogs.setIndex,
      setType: setLogs.setType,
      load: setLogs.load,
      reps: setLogs.reps,
      dropGroup: setLogs.dropSetGroup,
      equipmentId: setLogs.equipmentId,
      equipmentType: setLogs.equipmentType,
      workoutLogId: setLogs.workoutLogId,
      date: workoutLogs.date,
      exerciseId: setLogs.exerciseId,
      exerciseName: exercises.name,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .innerJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    // (date, id) for sessions; (set_index, id) within — set_index is the
    // logged order, id separates a drop segment from its parent.
    .orderBy(asc(workoutLogs.date), asc(workoutLogs.id), asc(setLogs.setIndex), asc(setLogs.id));

  const rows = exerciseId ? await base.where(eq(setLogs.exerciseId, exerciseId)) : await base;

  return rows.map((r) => ({
    id: r.id,
    setIndex: r.setIndex,
    setType: r.setType as StatSet["setType"],
    load: Number(r.load),
    reps: r.reps,
    dropGroup: r.dropGroup,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    workoutLogId: r.workoutLogId,
    date: r.date,
    lane: laneKey(r.equipmentType, r.equipmentId) ?? PORTABLE_LANE,
    hasUnit: r.equipmentId != null,
  }));
}

export interface UnitSpec {
  id: string;
  label: string;
  equipmentType: string | null;
  pulleyRatioKind: string | null;
  builtInWeight: number | null;
  plateIncrement: number | null;
  addOnWeight: number | null;
  stackMax: number | null;
  stackUnit: string | null;
}

export async function loadUnitSpecs(): Promise<Map<string, UnitSpec>> {
  const rows = await db.select().from(equipment);
  const n = (v: string | null) => (v == null ? null : Number(v));
  return new Map(
    rows.map((m) => [
      m.id,
      {
        id: m.id,
        label: m.label ?? m.id,
        equipmentType: m.equipmentType,
        pulleyRatioKind: m.pulleyRatioKind,
        builtInWeight: n(m.builtInWeight),
        plateIncrement: n(m.plateIncrement),
        addOnWeight: n(m.addOnWeight),
        stackMax: n(m.stackMax),
        stackUnit: m.stackUnit,
      },
    ])
  );
}

export interface DecisionRow {
  id: number;
  a: string;
  b: string;
  kind: "same_setup" | "ratio_estimate";
  status: "confirmed" | "rejected";
  basis: string;
  decidedAt: string;
}

export async function loadDecisions(): Promise<DecisionRow[]> {
  const rows = await db.select().from(equipmentComparability);
  return rows.map((r) => ({
    id: r.id,
    a: r.equipmentIdA,
    b: r.equipmentIdB,
    kind: r.kind as DecisionRow["kind"],
    status: r.status as DecisionRow["status"],
    basis: r.basis,
    decidedAt: r.decidedAt.toISOString(),
  }));
}
