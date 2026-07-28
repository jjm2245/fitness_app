import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, setLogs, cardioLogs, exercises, sessionExercises } from "@/db/schema";

// GET /api/sessions/[id] — one session in full, keyed by client_session_id.
// Used to hydrate the local store when opening a session that lives only on the
// server. Returns the ordered performed list (session_exercises), or — for a
// legacy session with none — one synthesized occurrence per distinct logged
// exercise. Sets/cardio carry their session_exercise link so the client can
// re-attach each to the right occurrence.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [log] = await db.select().from(workoutLogs).where(eq(workoutLogs.clientSessionId, id));
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sets = await db
    .select({
      id: setLogs.id,
      sessionExerciseId: setLogs.sessionExerciseId,
      exerciseId: setLogs.exerciseId,
      equipmentId: setLogs.equipmentId,
      equipmentType: setLogs.equipmentType,
      setIndex: setLogs.setIndex,
      setType: setLogs.setType,
      load: setLogs.load,
      reps: setLogs.reps,
      effort: setLogs.effort,
      rir: setLogs.rir,
      loggedAt: setLogs.loggedAt,
      notes: setLogs.notes,
      restSeconds: setLogs.restSeconds,
      restSource: setLogs.restSource,
      dropSetGroup: setLogs.dropSetGroup,
      side: setLogs.side,
      loadEntered: setLogs.loadEntered,
      builtinOffset: setLogs.builtinOffset,
    })
    .from(setLogs)
    .where(eq(setLogs.workoutLogId, log.id))
    .orderBy(setLogs.id);

  const cardio = await db
    .select({
      id: cardioLogs.id,
      sessionExerciseId: cardioLogs.sessionExerciseId,
      exerciseId: cardioLogs.exerciseId,
      durationMin: cardioLogs.durationMin,
      incline: cardioLogs.incline,
      speed: cardioLogs.speed,
      distance: cardioLogs.distance,
      level: cardioLogs.level,
      load: cardioLogs.load,
      effort: cardioLogs.effort,
      restSeconds: cardioLogs.restSeconds,
      restSource: cardioLogs.restSource,
      dropSetGroup: cardioLogs.dropSetGroup,
      setType: cardioLogs.setType,
      notes: cardioLogs.notes,
    })
    .from(cardioLogs)
    .where(eq(cardioLogs.workoutLogId, log.id))
    .orderBy(cardioLogs.id);

  const occ = await db
    .select({
      id: sessionExercises.id,
      clientInstanceId: sessionExercises.clientInstanceId,
      exerciseId: sessionExercises.exerciseId,
      orderIndex: sessionExercises.orderIndex,
      source: sessionExercises.source,
      completed: sessionExercises.completed,
    })
    .from(sessionExercises)
    .where(eq(sessionExercises.workoutLogId, log.id))
    .orderBy(sessionExercises.orderIndex);

  // The ordered list is the real occurrences, or (legacy) one per distinct
  // logged exercise, ordered by first appearance.
  type OccRow = { sessionExerciseId: number | null; clientInstanceId: string | null; exerciseId: string; orderIndex: number; source: string | null; completed: boolean };
  let occRows: OccRow[];
  if (occ.length > 0) {
    occRows = occ.map((o) => ({
      sessionExerciseId: o.id,
      clientInstanceId: o.clientInstanceId,
      exerciseId: o.exerciseId,
      orderIndex: o.orderIndex,
      source: o.source,
      completed: o.completed,
    }));
  } else {
    const seen: string[] = [];
    for (const s of sets) if (!seen.includes(s.exerciseId)) seen.push(s.exerciseId);
    for (const c of cardio) if (!seen.includes(c.exerciseId)) seen.push(c.exerciseId);
    occRows = seen.map((exerciseId, i) => ({
      sessionExerciseId: null,
      clientInstanceId: null,
      exerciseId,
      orderIndex: i,
      source: log.programDay,
      completed: false,
    }));
  }

  // Metadata for every exercise that appears, so the client renders cards
  // without a round-trip each.
  const exerciseIds = Array.from(new Set(occRows.map((o) => o.exerciseId)));
  const exerciseMeta = exerciseIds.length
    ? await db.select().from(exercises).where(inArray(exercises.id, exerciseIds))
    : [];
  const metaById = new Map(exerciseMeta.map((e) => [e.id, e]));

  const exercisesOut = occRows.map((o) => {
    const m = metaById.get(o.exerciseId);
    return {
      sessionExerciseId: o.sessionExerciseId,
      clientInstanceId: o.clientInstanceId,
      exerciseId: o.exerciseId,
      exerciseName: m?.name ?? o.exerciseId,
      loadType: m?.loadType ?? "free_weight",
      portable: m?.portable ?? true,
      conditioningOnly: m?.conditioningOnly ?? false,
      provenance: m?.source ?? "custom",
      untagged: m?.untagged ?? true,
      unilateral: m?.unilateral ?? false,
      params: m?.params ?? null,
      logFields: m?.logFields ?? null,
      canonicalName: m?.canonicalName ?? null,
      orderIndex: o.orderIndex,
      source: o.source,
      completed: o.completed,
    };
  });

  return NextResponse.json({
    id: log.clientSessionId,
    clientSessionId: log.clientSessionId,
    date: log.date,
    programDay: log.programDay,
    finishedAt: log.finishedAt,
    notes: log.notes,
    firstFinishedAt: log.firstFinishedAt,
    firstFinishedSource: log.firstFinishedSource,
    exercises: exercisesOut,
    sets,
    cardio,
  });
}

// DELETE /api/sessions/[id] — remove a whole session, keyed by client_session_id.
// set_logs / cardio_logs / session_exercises cascade off workout_logs, so one
// delete cleans everything. Idempotent: a 404 (already gone / never synced) is
// fine, so the client's offline delete queue can retry safely.
// PATCH /api/sessions/[id] — edit a session's date and/or first-finish time.
// The value is USER-PROVIDED (source 'user', same pattern as rest_source): the
// honest way to fix a morning-after log or a stamp that inherited corruption —
// traceable as the user's input, never mistakable for a system value. A null
// firstFinishedAt clears the time (honest blank). 404 while the session hasn't
// synced yet — the client keeps the edit pending and retries after the log row
// exists.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const updates: { date?: string; firstFinishedAt?: Date | null; firstFinishedSource?: string; notes?: string | null } = {};
  // Empty or whitespace-only clears to NULL — "no note" is one state, not two.
  if (body?.notes !== undefined) {
    updates.notes = typeof body.notes === "string" && body.notes.trim() !== "" ? body.notes.trim() : null;
  }
  if (body?.date !== undefined) {
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    updates.date = body.date;
  }
  if (body?.firstFinishedAt !== undefined) {
    if (body.firstFinishedAt === null) updates.firstFinishedAt = null;
    else {
      const t = new Date(body.firstFinishedAt);
      if (Number.isNaN(t.getTime())) return NextResponse.json({ error: "firstFinishedAt must be an ISO instant or null" }, { status: 400 });
      // Same impossible-state rule the editor enforces, restated at the sync
      // boundary — a stale client, a replayed request, or a future caller must
      // not be able to write an end that precedes the session's start.
      // `created_at` is `timestamp WITHOUT time zone`, and this driver parses
      // such a column in the RUNNING PROCESS's timezone — so comparing against
      // it raw would make this guard four hours looser on a non-UTC host. Ask
      // Postgres for the true instant instead: the value was written by `now()`
      // under the database's TimeZone, so that is what re-interprets it.
      const [row] = await db
        .select({
          startedAt: sql<string | null>`to_char(
            (${workoutLogs.createdAt} at time zone current_setting('TimeZone')) at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )`,
        })
        .from(workoutLogs)
        .where(eq(workoutLogs.clientSessionId, id));
      const startedMs = row?.startedAt ? Date.parse(row.startedAt) : NaN;
      if (Number.isFinite(startedMs) && t.getTime() < startedMs) {
        return NextResponse.json(
          { error: "firstFinishedAt precedes the session's start", startedAt: row!.startedAt, given: t.toISOString() },
          { status: 400 }
        );
      }
      updates.firstFinishedAt = t;
    }
    updates.firstFinishedSource = "user";
  }
  // A DATE-only edit deliberately does NOT stamp firstFinishedSource. The column
  // means "this INSTANT was set by hand", matching the restSource: 'user'
  // convention it was modelled on — not "a user edited this row". Stamping it
  // here made the provenance unreadable: a row could claim a hand-set finish
  // time that the finish flow had actually stamped itself.
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [row] = await db
    .update(workoutLogs)
    .set(updates)
    .where(eq(workoutLogs.clientSessionId, id))
    .returning({ id: workoutLogs.id, date: workoutLogs.date, firstFinishedAt: workoutLogs.firstFinishedAt, firstFinishedSource: workoutLogs.firstFinishedSource });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [log] = await db.select({ id: workoutLogs.id }).from(workoutLogs).where(eq(workoutLogs.clientSessionId, id));
  if (!log) return NextResponse.json({ ok: true, alreadyGone: true });
  await db.delete(workoutLogs).where(eq(workoutLogs.id, log.id));
  return NextResponse.json({ ok: true });
}
