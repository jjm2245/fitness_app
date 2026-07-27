import { NextRequest, NextResponse } from "next/server";
import { asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
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
import { prettyDayName } from "@/lib/labels";
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

/**
 * A select shape in which every `timestamp WITHOUT time zone` column is
 * rendered by POSTGRES as a strict ISO-8601 Z string, and every other column is
 * passed through untouched.
 *
 * The bug this closes: node-postgres parses a tz-less timestamp in the RUNNING
 * PROCESS's timezone. `created_at = '2026-07-14 23:01:31'` came back as
 * `2026-07-15T03:01:31Z` when the export ran on a machine in America/New_York —
 * correct on Vercel (UTC) and four hours wrong anywhere else. A file whose
 * timestamps depend on where it was generated is not a backup.
 *
 * The value was WRITTEN by `now()` under the database's `TimeZone`, so it is
 * re-interpreted under that same setting rather than a hardcoded 'UTC' — prod
 * is GMT, the local dev database is America/New_York, and this is right for
 * both.
 *
 * Deliberately scoped to this route. The global fix is a `setTypeParser(1114, …)`
 * in `db/client.ts`, which changes the return type of every query in the app and
 * needs its own round with real verification — not a rider on an export change.
 */
function utcSafeShape(table: PgTable) {
  const cols = getTableColumns(table);
  const shape: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) {
    const c = col as unknown as { columnType: string; withTimezone?: boolean };
    shape[key] =
      c.columnType === "PgTimestamp" && c.withTimezone === false
        ? sql`to_char((${col} at time zone current_setting('TimeZone')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
        : col;
  }
  return shape as Record<string, never>;
}

/**
 * Human-readable aliases ADDED BESIDE the raw columns — never replacing them.
 *
 * Two names in this schema mislead anything reading the export cold:
 * `programs` has no `name` column at all (the display name lives in
 * `split_type`), and `program_days.name` mixes a seeded snake_case convention
 * (`chest_triceps`) with hand-renamed titles (`Legs + Shoulders`) inside one
 * program.
 *
 * Aliasing is the whole fix. Renaming the column would be a migration for a
 * label, and normalizing the stored day names would rewrite data that display
 * already humanizes — the raw form only ever surfaces in this one table.
 */
function withDisplayAliases(name: string, rows: unknown[]): unknown[] {
  if (name === "programs") {
    return rows.map((r) => ({ ...(r as Record<string, unknown>), name: (r as { splitType?: string }).splitType ?? null }));
  }
  if (name === "program_days") {
    return rows.map((r) => {
      const raw = (r as { name?: string }).name;
      return { ...(r as Record<string, unknown>), displayName: raw ? prettyDayName(raw) : null };
    });
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const format = params.get("format");
  if (format === "csv") {
    const table = params.get("table") ?? "sets";
    if (table === "sets") return setsCsvResponse();
    if (table === "sessions") return sessionsCsvResponse();
    return NextResponse.json({ error: "unsupported table", supported: ["sets", "sessions"] }, { status: 400 });
  }
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
    // utcSafeShape, not a bare select(): tz-less timestamps must be rendered by
    // Postgres, or the file's contents depend on where it was generated.
    const rows = await db.select(utcSafeShape(table)).from(table);
    tables[name] = withDisplayAliases(name, rows);
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
    // Shipped INSIDE the file, because the reader most likely to be misled is
    // one that never sees this repo.
    readingNotes: {
      set_index:
        "Not a count, and neither dense nor unique. A GAP means a set was deleted — indices are assigned at log time and never renumbered, because renumbering would rewrite history for cosmetics. A DUPLICATE is by design: a drop segment shares its parent's set_index, since they are one set performed in two stages. Pair duplicates via drop_set_group; the lowest set id in a group is the parent. To count sets, count rows; to order them, use logged_at.",
      absence:
        "NULL means NOT RECORDED, never a default and never zero. This holds for target_sets, log_fields, built_in_weight, stack_unit, rest_seconds, equipment_type and equipment_id. A recorded 0 is a real zero and is distinct from absence.",
      timestamps:
        "All instants are UTC ISO-8601. The app displays them in local time, so a value here will look shifted against what the screen shows.",
      finish_times:
        "workout_logs.finished_at re-stamps on every re-finish and is a last-modified marker. first_finished_at is the stable instant the session ended; the CSVs expose them as ended_at and last_updated_at.",
      body_metrics:
        "A TIME SERIES of dated weigh-ins, not a current value. The LATEST row by date is the current bodyweight. BACK-DATED rows are expected and valid — weights known from before the app was used are as real as today's — so rows do not arrive in insertion order and gaps between dates are normal, not missing data. One row per date (unique index): correcting a day's weight updates that day rather than adding a second row. Weight is canonical POUNDS.",
      profile:
        "A SINGLETON — at most one row, id = 1, enforced by a CHECK constraint. Its NULLs mean not-recorded like everywhere else, and a partially filled profile is a valid state rather than an error. height_in is canonical INCHES; dob is stored rather than age, so age is derived and never stale. training_years is years of consistent training; the older training_age enum column is retained but unused and should be ignored.",
      bodyweight_is_not_load:
        "Bodyweight is a body-composition metric and is NEVER added to set_logs.load. Bodyweight exercises (pullups, dips, captain's chair) correctly record load 0 when nothing was added — the load column measures what was ADDED to the body, not what was moved.",
    },
    tables,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * When a session ENDED.
 *
 * `finished_at` re-stamps on every re-finish, so it drifts: four of the owner's
 * seven finished sessions had diverged, one by eleven days. `first_finished_at`
 * is stamped once and never rewritten (a user correction sets it directly), so
 * it is the only column that answers "when did this session end". Anything
 * presenting `finished_at` as the end time is presenting a last-modified stamp.
 *
 * Legacy rows predate `first_finished_at`; for those `finished_at` is all there
 * is, and it hasn't been re-stamped either, so the coalesce is honest.
 *
 * Done in JS rather than a SQL `coalesce` on purpose: a raw `sql` expression
 * bypasses drizzle's column decoder and the timestamptz arrives as a Postgres
 * literal (`2026-07-11 20:01:50.016-04`) instead of an ISO instant. Reading the
 * two real columns keeps the decoder in the loop.
 */
function endedAt(r: { firstFinishedAt: Date | null; finishedAt: Date | null }): Date | null {
  return r.firstFinishedAt ?? r.finishedAt;
}

/**
 * `created_at` is `timestamp WITHOUT time zone`, so it carries a wall clock with
 * no offset. It was WRITTEN by `now()` under the database's `TimeZone` setting,
 * so re-interpreting it under that same setting recovers the true instant —
 * which is right for prod (GMT) and for the local dev database (America/
 * New_York) without hardcoding either.
 *
 * Hardcoding 'UTC' here was wrong by four hours locally; this is the version
 * that doesn't depend on where it runs.
 *
 * Formatted to a strict ISO-8601 Z string in SQL rather than handed back as a
 * value: a raw `sql` expression carries no column decoder, so drizzle would
 * return a Postgres literal that `new Date()` parses only by luck.
 */
const createdAtInstant = sql<string>`to_char(
  (${workoutLogs.createdAt} at time zone current_setting('TimeZone')) at time zone 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
)`;

/**
 * A correlated child count.
 *
 * BOTH sides are spelled out literally, and that is load-bearing. Interpolating
 * a drizzle column into a raw subquery renders it UNQUALIFIED — `${setLogs.
 * workoutLogId} = ${workoutLogs.id}` becomes `"workout_log_id" = "id"`, so both
 * names bind to the INNER table and every count silently comes back 0. No
 * error, just wrong numbers: the worst kind of bug, and one this export shipped
 * for exactly one iteration before the counts were checked against psql.
 */
function childCount(table: "set_logs" | "cardio_logs" | "session_exercises", expr = "count(*)") {
  return sql<number>`(select ${sql.raw(expr)} from ${sql.raw(table)} c where c.workout_log_id = workout_logs.id)`.mapWith(Number);
}

/**
 * How to read `set_index` — it is NOT a count, and it is neither dense nor
 * unique. Documented here because this is where a reader (including an LLM)
 * meets it cold, and both surprises look like data loss when they aren't:
 *
 *   GAPS mean a set was DELETED, not that a row is missing. Indices are
 *   assigned at log time and never renumbered, because renumbering would
 *   rewrite history for cosmetics. Real examples: 7/23 shoulder press runs
 *   1, 3, 4; 7/25 machine bench press runs 2, 3, 4.
 *
 *   DUPLICATES are by design. A drop segment shares its parent's `set_index` —
 *   they are one set performed in two stages, not two sets. Pair the duplicate
 *   with `drop_set_group`: rows sharing that id are one drop group, and the
 *   lowest `set_log_id` in it is the parent.
 *
 * To count sets, count rows. To order them, use `logged_at`.
 */
/** The denormalized `set_logs` view: ids resolved to names, one row per set. */
async function setsCsvResponse() {
  const rows = await db
    .select({
      set: setLogs,
      sessionDate: workoutLogs.date,
      firstFinishedAt: workoutLogs.firstFinishedAt,
      finishedAt: workoutLogs.finishedAt,
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
      // The true end time, then the re-stampable one — labelled for what it is.
      { key: "session_ended_at", get: (r) => endedAt(r) },
      { key: "session_last_updated_at", get: (r) => r.finishedAt },
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
      { key: "notes", get: (r) => r.set.notes },
      { key: "logged_at", get: (r) => r.set.loggedAt },
      { key: "created_at", get: (r) => r.set.createdAt },
    ],
    rows
  );

  return csv200(csv);
}

/**
 * One row per session.
 *
 * This exists because the set-level CSV structurally cannot show a session that
 * logged nothing — which is exactly how an empty session stayed invisible for
 * five hours. A sessions view surfaces `sets = 0` on sight.
 *
 * Counts are correlated subqueries rather than joins: three LEFT JOINs against
 * one parent multiply each other's rows, and the resulting set count would be
 * `sets × cardio × occurrences`. Slower, correct.
 */
async function sessionsCsvResponse() {
  const rows = await db
    .select({
      id: workoutLogs.id,
      date: workoutLogs.date,
      clientSessionId: workoutLogs.clientSessionId,
      programDay: workoutLogs.programDay,
      // Derived through the occurrence link, never `workout_logs.program_id` —
      // that column is deliberately never written (see DECISIONS), so emitting
      // it here would be a permanently blank column, which is worse than none.
      programNames: sql<string | null>`(
        select string_agg(distinct p.split_type, ' + ')
        from session_exercises se
        join program_days pd on pd.id = se.program_day_id
        join programs p on p.id = pd.program_id
        where se.workout_log_id = workout_logs.id and p.is_block_library = false)`,
      programIds: sql<string | null>`(
        select string_agg(distinct p.id::text, ' + ')
        from session_exercises se
        join program_days pd on pd.id = se.program_day_id
        join programs p on p.id = pd.program_id
        where se.workout_log_id = workout_logs.id and p.is_block_library = false)`,
      programCount: sql<number>`(
        select count(distinct p.id)
        from session_exercises se
        join program_days pd on pd.id = se.program_day_id
        join programs p on p.id = pd.program_id
        where se.workout_log_id = workout_logs.id and p.is_block_library = false)`.mapWith(Number),
      // Blocks are program_days of the hidden block-library "program". Counting
      // them as a program would put `__block_library__` in the name list of
      // almost every session; ignoring them entirely would lose where those
      // occurrences came from. They get their own count.
      blockOccurrences: sql<number>`(
        select count(*)
        from session_exercises se
        join program_days pd on pd.id = se.program_day_id
        join programs p on p.id = pd.program_id
        where se.workout_log_id = workout_logs.id and p.is_block_library = true)`.mapWith(Number),
      adhocOccurrences: sql<number>`(
        select count(*) from session_exercises se
        where se.workout_log_id = workout_logs.id and se.program_day_id is null)`.mapWith(Number),
      createdAt: createdAtInstant,
      firstFinishedAt: workoutLogs.firstFinishedAt,
      finishedAt: workoutLogs.finishedAt,
      endedSource: workoutLogs.firstFinishedSource,
      notes: workoutLogs.notes,
      occurrences: childCount("session_exercises"),
      sets: childCount("set_logs"),
      cardioEntries: childCount("cardio_logs"),
      distinctExercises: childCount("set_logs", "count(distinct c.exercise_id)"),
    })
    .from(workoutLogs)
    .orderBy(asc(workoutLogs.date), asc(workoutLogs.id));

  type Row = (typeof rows)[number];
  const csv = toCsv<Row>(
    [
      { key: "session_date", get: (r) => r.date },
      { key: "workout_log_id", get: (r) => r.id },
      { key: "client_session_id", get: (r) => r.clientSessionId },
      { key: "program_day", get: (r) => r.programDay },
      // A session can draw from two programs, or from none. Rather than picking
      // a winner, the names are listed, the count is stated, and a session with
      // no program-linked occurrence says so outright.
      { key: "programs", get: (r) => (r.programCount === 0 ? "(ad-hoc)" : r.programNames) },
      { key: "program_ids", get: (r) => r.programIds },
      { key: "program_count", get: (r) => r.programCount },
      { key: "block_occurrences", get: (r) => r.blockOccurrences },
      { key: "adhoc_occurrences", get: (r) => r.adhocOccurrences },
      { key: "started_at", get: (r) => r.createdAt },
      { key: "ended_at", get: (r) => endedAt(r) },
      { key: "ended_at_source", get: (r) => r.endedSource },
      { key: "last_updated_at", get: (r) => r.finishedAt },
      // Start → true end, in minutes. Null when unfinished. Deliberately NOT
      // clamped the way History clamps it for display: an export that silently
      // dropped an implausible span would hide the corrupt stamp worth seeing.
      { key: "duration_min", get: (r) => durationMin(r.createdAt, endedAt(r)) },
      // A session cannot end before it starts. When the stamps say otherwise
      // the duration goes negative, and a negative number in a spreadsheet is
      // easy to scroll past — so the contradiction gets its own column.
      {
        key: "ends_before_starts",
        get: (r) => {
          const d = durationMin(r.createdAt, endedAt(r));
          return d == null ? "" : d < 0 ? "YES" : "no";
        },
      },
      { key: "finished", get: (r) => (r.finishedAt == null ? "no" : "yes") },
      { key: "occurrences", get: (r) => r.occurrences },
      { key: "sets", get: (r) => r.sets },
      { key: "cardio_entries", get: (r) => r.cardioEntries },
      { key: "distinct_exercises", get: (r) => r.distinctExercises },
      { key: "notes", get: (r) => r.notes },
    ],
    rows
  );

  return csv200(csv);
}

function durationMin(startIso: string | null, end: Date | null): number | null {
  if (startIso == null || end == null) return null;
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return null;
  return Math.round((end.getTime() - start) / 60_000);
}

function csv200(csv: string) {
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
}
