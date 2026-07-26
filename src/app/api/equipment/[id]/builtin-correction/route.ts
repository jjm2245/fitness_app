import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { equipment, exercises, setLogs, workoutLogs } from "@/db/schema";
import { planCorrection, findDisagreements, type CorrectableRow } from "@/lib/builtinCorrection";

// Retroactive built-in correction for ONE unit.
//
//   GET  ?offset=N  → what correcting to N would do (preview). Omit `offset`
//                     and you get only the always-on disagreement report.
//   POST { offset, includeNullOffset } → apply it, transactionally.
//
// `cardio_logs` has no `equipment_id`, so it cannot be scoped to a unit and is
// out of scope here by construction — a metric entry's load is whatever was
// typed, with no built-in ever applied.

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

async function loadRows(equipmentId: string, onlyWithOffset: boolean): Promise<CorrectableRow[]> {
  const rows = await db
    .select({
      id: setLogs.id,
      date: sql<string>`to_char(${workoutLogs.date}, 'YYYY-MM-DD')`,
      exercise: exercises.name,
      load: setLogs.load,
      loadEntered: setLogs.loadEntered,
      builtinOffset: setLogs.builtinOffset,
      reps: setLogs.reps,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .innerJoin(exercises, eq(setLogs.exerciseId, exercises.id))
    .where(
      onlyWithOffset
        ? and(eq(setLogs.equipmentId, equipmentId), isNotNull(setLogs.builtinOffset))
        : and(eq(setLogs.equipmentId, equipmentId), isNull(setLogs.builtinOffset))
    );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    exercise: r.exercise,
    load: Number(r.load),
    loadEntered: r.loadEntered != null ? Number(r.loadEntered) : null,
    builtinOffset: r.builtinOffset != null ? Number(r.builtinOffset) : null,
    reps: r.reps,
  }));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const [unit] = await db.select().from(equipment).where(eq(equipment.id, id));
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

  const withOffsetRows = await loadRows(id, true);
  const nullOffsetRows = await loadRows(id, false);
  const unitBuiltIn = unit.builtInWeight != null ? Number(unit.builtInWeight) : null;

  // Always-on, read-only: rows whose recorded offset contradicts the unit's.
  const disagreements = findDisagreements(withOffsetRows, unitBuiltIn);

  const offsetParam = request.nextUrl.searchParams.get("offset");
  const offset = offsetParam != null && offsetParam !== "" ? Number(offsetParam) : null;
  const preview =
    offset != null && Number.isFinite(offset)
      ? {
          offset,
          withOffset: planCorrection(withOffsetRows, offset),
          nullOffset: planCorrection(nullOffsetRows, offset),
        }
      : null;

  return NextResponse.json({
    unitId: id,
    label: unit.label,
    builtInWeight: unitBuiltIn,
    stackUnit: unit.stackUnit ?? null,
    counts: { withOffset: withOffsetRows.length, nullOffset: nullOffsetRows.length },
    disagreements,
    preview,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const body = await request.json().catch(() => null);
  const offset = num(body?.offset);
  if (offset == null) return NextResponse.json({ error: "offset must be a number" }, { status: 400 });
  const includeNullOffset = body?.includeNullOffset === true;

  const [unit] = await db.select().from(equipment).where(eq(equipment.id, id));
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

  const withOffsetRows = await loadRows(id, true);
  const nullOffsetRows = includeNullOffset ? await loadRows(id, false) : [];
  const planA = planCorrection(withOffsetRows, offset);
  const planB = planCorrection(nullOffsetRows, offset);
  const all = [...planA.changes, ...planB.changes];
  if (all.length === 0) return NextResponse.json({ ok: true, updated: 0, nullUpdated: 0 });

  // One transaction: a half-applied correction would leave the invariant
  // (load = load_entered + builtin_offset) broken across the unit's history.
  await db.transaction(async (tx) => {
    for (const c of all) {
      await tx
        .update(setLogs)
        .set({
          load: c.loadAfter.toString(),
          loadEntered: c.offsetAfter != null ? c.loadEntered.toString() : null,
          builtinOffset: c.offsetAfter != null ? c.offsetAfter.toString() : null,
        })
        .where(eq(setLogs.id, c.id));
    }
  });

  // Report exactly what was written, so the caller can diff it against the
  // preview it showed rather than trust that they matched.
  const ids = all.map((c) => c.id);
  const after = await db
    .select({ id: setLogs.id, load: setLogs.load, loadEntered: setLogs.loadEntered, builtinOffset: setLogs.builtinOffset })
    .from(setLogs)
    .where(inArray(setLogs.id, ids));

  return NextResponse.json({
    ok: true,
    updated: planA.changes.length,
    nullUpdated: planB.changes.length,
    rows: after.map((r) => ({
      id: r.id,
      load: Number(r.load),
      loadEntered: r.loadEntered != null ? Number(r.loadEntered) : null,
      builtinOffset: r.builtinOffset != null ? Number(r.builtinOffset) : null,
    })),
  });
}
