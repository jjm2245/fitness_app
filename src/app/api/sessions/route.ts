import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, setLogs, cardioLogs, sessionExercises } from "@/db/schema";

// A zero-content unfinished session is a husk: Start was tapped and nothing came
// of it. Mirrors the local store's sweepEmptySessions age guard EXACTLY (5 min)
// so there is ONE rule in two places rather than two rules that drift. The guard
// is what makes it safe — a session started moments ago is never hidden
// mid-entry, it just hasn't earned a row yet.
const HUSK_AGE_MS = 5 * 60_000;

// GET /api/sessions — the sessions that live on the server, newest first.
//
// Returns FINISHED sessions plus UNFINISHED ones that carry LOGGED content
// (sets + cardio > 0). Unfinished sessions used to be filtered out entirely,
// which made them invisible in the list — and since the list is also the only
// place a session can be deleted, invisible meant undeletable: seven of them
// accumulated silently.
//
// CONTENT MEANS LOGGED, NOT PLANNED. Occurrences are excluded on purpose:
// adding an exercise states an intention, not a fact. Counting them let a
// session survive five hours in prod on one occurrence and zero sets — Start
// tapped, one exercise added, nothing logged.
//
// Both directions still matter, and this predicate keeps both: a session with
// sets and NO occurrences (the pre-occurrence-model shape) is content and stays
// visible, because `set_logs` is checked independently of `session_exercises`.
//
// This is the *synced* half of the sessions list; the client merges it with its
// local durable store (offline + in-flight), keyed by clientSessionId, so the
// list never depends on a network round-trip. Each row carries a derived short
// description (program day name — or "Ad-hoc" — plus a distinct exercise count)
// so the client doesn't have to re-fetch every set to label a session.
export async function GET() {
  // (b) Husk sweep, best-effort and non-fatal: drop UNFINISHED sessions with no
  // sets and no cardio, older than the age guard. Same predicate and same
  // 5-minute threshold as the local sweep (`discardSessionIfEmpty`), so the two
  // cannot drift. Recoverable by construction — a device that still holds such
  // a session locally re-creates the row on its next sync.
  //
  // The occurrence cascade is what makes this safe to widen: deleting the log
  // takes its `session_exercises` with it (ON DELETE CASCADE), and there are no
  // sets to orphan, because "no sets" is the precondition.
  //
  // THE AGE COMPARISON BELOW IS CORRECT AS WRITTEN — do not "fix" it.
  // `created_at` is `timestamp WITHOUT time zone` and it is compared against a
  // bound JS Date, which looks like the login_attempts bug and is not. When
  // Postgres compares a timestamp to a timestamptz it casts the timestamp using
  // the session `TimeZone`, which is exactly the zone `defaultNow()` wrote it
  // in — nothing else ever writes this column. Verified empirically on the
  // local America/New_York database: the bare comparison and an explicit
  // `at time zone current_setting('TimeZone')` agree on every row.
  //
  // What DID break login_attempts was the write side: values arriving from the
  // app in the PROCESS's zone mixed with `now()` values in the DB's zone. That
  // hazard is real and is recorded in SPEC-DRIFT; it does not apply here.
  try {
    await db.execute(sql`
      delete from ${workoutLogs}
      where ${workoutLogs.finishedAt} is null
        and ${workoutLogs.createdAt} < ${new Date(Date.now() - HUSK_AGE_MS)}
        and not exists (select 1 from ${setLogs} where ${setLogs.workoutLogId} = ${workoutLogs.id})
        and not exists (select 1 from ${cardioLogs} where ${cardioLogs.workoutLogId} = ${workoutLogs.id})`);
  } catch {
    /* sweeping is housekeeping — never fail the list because of it */
  }

  const logs = await db
    .select({
      id: workoutLogs.id,
      clientSessionId: workoutLogs.clientSessionId,
      date: workoutLogs.date,
      programDay: workoutLogs.programDay,
      finishedAt: workoutLogs.finishedAt,
      // The stable first-finish instant — display/sort anchor. finished_at
      // re-stamps on every re-finish and must never place a session in history.
      firstFinishedAt: workoutLogs.firstFinishedAt,
    })
    .from(workoutLogs)
    // (a) Finished, OR unfinished-with-LOGGED-content. Must stay identical to
    // the sweep predicate above and to `discardSessionIfEmpty` — a row this
    // filter hides but the sweep spares is exactly the undeletable husk.
    .where(
      sql`(
        ${workoutLogs.finishedAt} is not null
        or exists (select 1 from ${setLogs} where ${setLogs.workoutLogId} = ${workoutLogs.id})
        or exists (select 1 from ${cardioLogs} where ${cardioLogs.workoutLogId} = ${workoutLogs.id})
      )`
    )
    .orderBy(desc(workoutLogs.date), desc(workoutLogs.firstFinishedAt));

  if (logs.length === 0) return NextResponse.json([]);

  // Performed-occurrence count per session (v2 — the ordered list length, so
  // repeats count). Falls back to distinct logged exercises for legacy sessions
  // with no session_exercises rows.
  const occCounts = await db
    .select({
      workoutLogId: sessionExercises.workoutLogId,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(sessionExercises)
    .groupBy(sessionExercises.workoutLogId);

  const setCounts = await db
    .select({
      workoutLogId: setLogs.workoutLogId,
      n: sql<number>`count(distinct ${setLogs.exerciseId})`.mapWith(Number),
    })
    .from(setLogs)
    .groupBy(setLogs.workoutLogId);

  const cardioCounts = await db
    .select({
      workoutLogId: cardioLogs.workoutLogId,
      n: sql<number>`count(distinct ${cardioLogs.exerciseId})`.mapWith(Number),
    })
    .from(cardioLogs)
    .groupBy(cardioLogs.workoutLogId);

  const occByLog = new Map<number, number>();
  for (const r of occCounts) occByLog.set(r.workoutLogId, r.n);
  const loggedByLog = new Map<number, number>();
  for (const r of setCounts) loggedByLog.set(r.workoutLogId, (loggedByLog.get(r.workoutLogId) ?? 0) + r.n);
  for (const r of cardioCounts) loggedByLog.set(r.workoutLogId, (loggedByLog.get(r.workoutLogId) ?? 0) + r.n);
  const counts = new Map<number, number>();
  for (const l of logs) counts.set(l.id, occByLog.get(l.id) ?? loggedByLog.get(l.id) ?? 0);

  const rows = logs.map((l) => {
    const exerciseCount = counts.get(l.id) ?? 0;
    return {
      id: l.clientSessionId ?? `log-${l.id}`,
      clientSessionId: l.clientSessionId,
      date: l.date,
      finishedAt: l.finishedAt,
      firstFinishedAt: l.firstFinishedAt,
      programDay: l.programDay,
      exerciseCount,
      description: describeSession(l.programDay, exerciseCount),
      synced: true,
    };
  });

  return NextResponse.json(rows);
}

function describeSession(programDay: string | null, exerciseCount: number): string {
  const label = programDay?.trim() ? programDay.trim() : "Ad-hoc";
  const ex = exerciseCount === 1 ? "1 exercise" : `${exerciseCount} exercises`;
  return `${label} · ${ex}`;
}
