import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, sessionExercises } from "@/db/schema";

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
    const keepIds = body.exercises.map((e) => e.clientInstanceId);
    const toPrune = await tx
      .select({ id: sessionExercises.id, cid: sessionExercises.clientInstanceId })
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutLogId, workoutLog.id));
    const pruneIds = toPrune
      .filter((r) => r.cid != null && !keepIds.includes(r.cid))
      .map((r) => r.id);
    if (pruneIds.length) {
      await tx.delete(sessionExercises).where(
        and(eq(sessionExercises.workoutLogId, workoutLog.id), inArray(sessionExercises.id, pruneIds))
      );
    }
  });

  return NextResponse.json({ ok: true });
}
