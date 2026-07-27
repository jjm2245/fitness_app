import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  profile,
  bodyMetrics,
  programs,
  programDays,
  programExercises,
  exercises,
  muscles,
  exerciseMuscles,
  exerciseSubstitutions,
  equipment,
  exerciseEquipment,
  workoutLogs,
  sessionExercises,
  setLogs,
  cardioLogs,
  injuryFlags,
  recoveryMetrics,
  nutritionEntries,
  progressPhotos,
  formChecks,
} from "@/db/schema";
import { appliedMigrationCount, EXPECTED_MIGRATIONS } from "@/lib/migrationStatus";
import { toCsv } from "@/lib/exportCsv";
import pkg from "../../../../package.json";

// GET /api/export — a complete, read-only snapshot of everything this app
// stores about the owner.
//
// STRICTLY READ-ONLY. Nothing here writes, migrates, or mutates: it is a pile
// of SELECTs and a serializer. Nothing is stored server-side either — the
// response IS the export; the browser turns it into a file.
//
// `?format=csv` returns the one table worth opening in a spreadsheet
// (`set_logs`, denormalized), not a second copy of the whole thing.
//
// Auth: covered by the proxy matcher (src/proxy.ts) like every other /api
// route — an expired session gets a 401, not a snapshot.

export const dynamic = "force-dynamic";

/**
 * The export's shape contract.
 *
 * Bumped only when the SHAPE changes in a way a reader must know about (a table
 * removed, a key renamed). Adding a table is backward-compatible and does not
 * bump it — a reader that ignores unknown keys keeps working.
 */
const FORMAT_VERSION = 1;

/**
 * Every table in the export, in dependency order (parents first), so the array
 * order alone is a valid insert order for a future restore.
 *
 * The list is EXPLICIT rather than derived from the schema module: a new table
 * should have to be consciously added to the export, not silently swept in or —
 * worse — silently missed because someone renamed an export in schema.ts.
 */
const TABLES = [
  // — About you —
  { name: "profile", table: profile },
  { name: "body_metrics", table: bodyMetrics },
  // — The exercise library and its graph —
  // The FULL library ships, not just customs: set_logs.exercise_id and
  // program_exercises.exercise_id are foreign keys into it. An export holding
  // only the 2 custom rows would need the seed re-run at exactly the right
  // version to resolve the other 26 exercises in history — and any drift there
  // orphans logged sets, the one thing this project never allows.
  { name: "muscles", table: muscles },
  { name: "exercises", table: exercises },
  { name: "exercise_muscles", table: exerciseMuscles },
  { name: "exercise_substitutions", table: exerciseSubstitutions },
  // — Equipment —
  { name: "equipment", table: equipment },
  { name: "exercise_equipment", table: exerciseEquipment },
  // — The program —
  { name: "programs", table: programs },
  { name: "program_days", table: programDays },
  { name: "program_exercises", table: programExercises },
  // — History (the irreplaceable part) —
  { name: "workout_logs", table: workoutLogs },
  { name: "session_exercises", table: sessionExercises },
  { name: "set_logs", table: setLogs },
  { name: "cardio_logs", table: cardioLogs },
  // — Declared but not yet written by any screen. Included anyway: an export
  //   that quietly skipped tables would be lying about being complete, and the
  //   day one of them starts filling up nobody would remember to add it. —
  { name: "injury_flags", table: injuryFlags },
  { name: "recovery_metrics", table: recoveryMetrics },
  { name: "nutrition_entries", table: nutritionEntries },
  { name: "progress_photos", table: progressPhotos },
  { name: "form_checks", table: formChecks },
] as const;

/**
 * Deliberately NOT exported, and why. Shipped inside the file so the omission
 * is visible to whoever opens it rather than buried in a doc.
 */
const EXCLUDED = [
  {
    table: "login_attempts",
    reason:
      "Rate-limiting telemetry (IP addresses + timestamps), not training data. Regenerates itself; exporting it would copy IPs into a file for no benefit.",
  },
  {
    table: "drizzle.__drizzle_migrations",
    reason: "Schema bookkeeping. A restore applies migrations from the repo, not from this file.",
  },
] as const;

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format");
  if (format === "csv") return csvResponse();
  if (format != null && format !== "json") {
    return NextResponse.json({ error: "unsupported format", supported: ["json", "csv"] }, { status: 400 });
  }
  return jsonResponse();
}

async function jsonResponse() {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  // Sequential, not Promise.all: the pool is capped at 5 connections (see
  // db/client.ts) and an export is a background chore, not a hot path. Doing
  // this in parallel would starve whatever else the owner is doing.
  for (const { name, table } of TABLES) {
    const rows = await db.select().from(table);
    tables[name] = rows;
    counts[name] = rows.length;
  }

  const payload = {
    format: "fitness-agent-export",
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: {
      version: pkg.version,
      migrationsApplied: await appliedMigrationCount(),
      migrationsExpected: EXPECTED_MIGRATIONS,
    },
    // Row counts alongside the rows: open the file and you can see at a glance
    // whether it's complete, without trusting that the download finished.
    counts,
    excluded: EXCLUDED,
    // Canonical units, stated in the file. A number in here is meaningless
    // without them, and the display preference is a per-device reading choice
    // that never touched storage.
    units: { weight: "lb", distance: "mi", duration: "min", rest: "s" },
    tables,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** The denormalized `set_logs` view: ids resolved to names, one row per set. */
async function csvResponse() {
  const rows = await db
    .select({
      set: setLogs,
      sessionDate: workoutLogs.date,
      sessionFinishedAt: workoutLogs.finishedAt,
      exerciseName: exercises.name,
      equipmentLabel: equipment.label,
      equipmentGym: equipment.gym,
    })
    .from(setLogs)
    .innerJoin(workoutLogs, eq(setLogs.workoutLogId, workoutLogs.id))
    .innerJoin(exercises, eq(setLogs.exerciseId, exercises.id))
    // LEFT: a portable-type set has no unit, and that absence is correct, not
    // a missing join.
    .leftJoin(equipment, eq(setLogs.equipmentId, equipment.id))
    .orderBy(asc(workoutLogs.date), asc(setLogs.workoutLogId), asc(setLogs.id));

  type Row = (typeof rows)[number];
  const csv = toCsv<Row>(
    [
      { key: "session_date", get: (r) => r.sessionDate },
      { key: "session_finished_at", get: (r) => r.sessionFinishedAt },
      { key: "workout_log_id", get: (r) => r.set.workoutLogId },
      { key: "session_exercise_id", get: (r) => r.set.sessionExerciseId },
      { key: "set_log_id", get: (r) => r.set.id },
      { key: "exercise_id", get: (r) => r.set.exerciseId },
      { key: "exercise_name", get: (r) => r.exerciseName },
      { key: "set_index", get: (r) => r.set.setIndex },
      { key: "set_type", get: (r) => r.set.setType },
      // The effective total is what the core reads; the two components below
      // are the transparent math behind it (entered + built-in).
      { key: "load_lb", get: (r) => r.set.load },
      { key: "load_entered_lb", get: (r) => r.set.loadEntered },
      { key: "builtin_offset_lb", get: (r) => r.set.builtinOffset },
      { key: "reps", get: (r) => r.set.reps },
      { key: "effort", get: (r) => r.set.effort },
      { key: "rir", get: (r) => r.set.rir },
      { key: "side", get: (r) => r.set.side },
      { key: "drop_set_group", get: (r) => r.set.dropSetGroup },
      { key: "equipment_type", get: (r) => r.set.equipmentType },
      { key: "equipment_id", get: (r) => r.set.equipmentId },
      { key: "equipment_label", get: (r) => r.equipmentLabel },
      { key: "equipment_gym", get: (r) => r.equipmentGym },
      { key: "rest_seconds", get: (r) => r.set.restSeconds },
      { key: "rest_source", get: (r) => r.set.restSource },
      { key: "rom_note", get: (r) => r.set.romNote },
      { key: "notes", get: (r) => r.set.notes },
      { key: "logged_at", get: (r) => r.set.loggedAt },
      { key: "created_at", get: (r) => r.set.createdAt },
    ],
    rows
  );

  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
}
