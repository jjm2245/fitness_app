import { NextResponse } from "next/server";
import { desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, setLogs, cardioLogs, sessionExercises } from "@/db/schema";

// GET /api/sessions — the finished sessions that live on the server, newest
// first. This is the *synced* half of the sessions list; the client merges it
// with its local durable store (offline + in-flight), keyed by clientSessionId,
// so the list never depends on a network round-trip. Each row carries a derived
// short description (program day name — or "Ad-hoc" — plus a distinct exercise
// count) so the client doesn't have to re-fetch every set to label a session.
export async function GET() {
  const logs = await db
    .select({
      id: workoutLogs.id,
      clientSessionId: workoutLogs.clientSessionId,
      date: workoutLogs.date,
      programDay: workoutLogs.programDay,
      finishedAt: workoutLogs.finishedAt,
    })
    .from(workoutLogs)
    .where(isNotNull(workoutLogs.finishedAt))
    .orderBy(desc(workoutLogs.finishedAt));

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
