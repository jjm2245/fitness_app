import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, sessionExercises, setLogs, cardioLogs } from "@/db/schema";

// POST /api/session-exercises — sync a session's ordered performed list (v2).
// The client owns each occurrence via client_instance_id, so this upserts the
// workout_log (by client session id) and the session_exercises for it, then
// prunes any client-owned rows no longer in the list (a removed/reordered
// occurrence). Occurrences sync before sets so set-logs can link by instance.
interface Payload {
  clientSessionId: string;
  date: string;
  programDay?: string | null;
  exercises: Array<{
    clientInstanceId: string;
    exerciseId: string;
    orderIndex: number;
    source?: string | null;
  }>;
}

export async function POST(request: NextRequest) {
  const body: Payload = await request.json();
  if (!body.clientSessionId || !body.date || !Array.isArray(body.exercises)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const keptWithHistory: string[] = [];
  await db.transaction(async (tx) => {
    let [workoutLog] = await tx
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.clientSessionId, body.clientSessionId));
    if (!workoutLog) {
      [workoutLog] = await tx
        .insert(workoutLogs)
        .values({ date: body.date, programDay: body.programDay ?? null, clientSessionId: body.clientSessionId })
        .returning();
    } else if (body.programDay != null && body.programDay !== workoutLog.programDay) {
      // Keep the aggregated session name in sync as it grows.
      await tx.update(workoutLogs).set({ programDay: body.programDay }).where(eq(workoutLogs.id, workoutLog.id));
    }

    for (const e of body.exercises) {
      const [existing] = await tx
        .select({ id: sessionExercises.id })
        .from(sessionExercises)
        .where(eq(sessionExercises.clientInstanceId, e.clientInstanceId));
      if (existing) {
        await tx
          .update(sessionExercises)
          .set({ orderIndex: e.orderIndex, source: e.source ?? null, exerciseId: e.exerciseId, workoutLogId: workoutLog.id })
          .where(eq(sessionExercises.id, existing.id));
      } else {
        await tx.insert(sessionExercises).values({
          workoutLogId: workoutLog.id,
          exerciseId: e.exerciseId,
          clientInstanceId: e.clientInstanceId,
          orderIndex: e.orderIndex,
          source: e.source ?? null,
        });
      }
    }

    // Prune client-owned occurrences that dropped out of the list (removed).
    // Rows with a null client_instance_id (legacy) are left alone.
    //
    // SAFETY (wrong-side-wins guard): only prune an occurrence that has NO logged
    // sets/cardio. A stale/wiped client re-POSTing a short list must never make us
    // delete real logged history — this caps the blast radius to empty rows. A
    // legit removal of an occurrence that HAS synced sets isn't lost: the client
    // deletes those sets (a later sync step), then re-POSTs, and by then the row
    // is empty and prunes. Until then the server keeps it and reports it in
    // `keptWithHistory` so the client knows to retry.
    const keepIds = body.exercises.map((e) => e.clientInstanceId);
    const owned = await tx
      .select({ id: sessionExercises.id, cid: sessionExercises.clientInstanceId })
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutLogId, workoutLog.id));
    const candidates = owned.filter((r) => r.cid != null && !keepIds.includes(r.cid));

    if (candidates.length) {
      const candidateIds = candidates.map((c) => c.id);
      const withSets = await tx
        .select({ id: setLogs.sessionExerciseId })
        .from(setLogs)
        .where(inArray(setLogs.sessionExerciseId, candidateIds));
      const withCardio = await tx
        .select({ id: cardioLogs.sessionExerciseId })
        .from(cardioLogs)
        .where(inArray(cardioLogs.sessionExerciseId, candidateIds));
      const hasHistory = new Set<number>();
      for (const r of withSets) if (r.id != null) hasHistory.add(r.id);
      for (const r of withCardio) if (r.id != null) hasHistory.add(r.id);

      const pruneIds: number[] = [];
      for (const c of candidates) {
        if (hasHistory.has(c.id)) keptWithHistory.push(c.cid!);
        else pruneIds.push(c.id);
      }
      if (pruneIds.length) {
        await tx.delete(sessionExercises).where(
          and(eq(sessionExercises.workoutLogId, workoutLog.id), inArray(sessionExercises.id, pruneIds))
        );
      }
    }
  });

  // Non-empty => the client asked to drop occurrence(s) that still carry logged
  // sets/cardio; we kept them (never auto-delete history). The client retries
  // after it has deleted those sets, at which point they prune cleanly.
  return NextResponse.json({ ok: true, keptWithHistory });
}
