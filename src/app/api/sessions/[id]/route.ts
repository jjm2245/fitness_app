import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs, setLogs, cardioLogs, exercises } from "@/db/schema";

// GET /api/sessions/[id] — one session in full, keyed by client_session_id.
// Used to hydrate the local store when opening a session that lives only on the
// server (e.g. finished on another device, or after a local store reset). It
// returns everything needed to rebuild the log screen offline afterwards: the
// distinct exercises (with the metadata the cards need) plus their logged sets
// and cardio, each carrying its server id so later edits/deletes route by it.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [log] = await db.select().from(workoutLogs).where(eq(workoutLogs.clientSessionId, id));
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sets = await db
    .select({
      id: setLogs.id,
      exerciseId: setLogs.exerciseId,
      machineId: setLogs.machineId,
      setIndex: setLogs.setIndex,
      setType: setLogs.setType,
      load: setLogs.load,
      reps: setLogs.reps,
      effort: setLogs.effort,
      rir: setLogs.rir,
    })
    .from(setLogs)
    .where(eq(setLogs.workoutLogId, log.id))
    .orderBy(setLogs.id);

  const cardio = await db
    .select({
      id: cardioLogs.id,
      exerciseId: cardioLogs.exerciseId,
      durationMin: cardioLogs.durationMin,
      incline: cardioLogs.incline,
      speed: cardioLogs.speed,
      distance: cardioLogs.distance,
      level: cardioLogs.level,
      notes: cardioLogs.notes,
    })
    .from(cardioLogs)
    .where(eq(cardioLogs.workoutLogId, log.id))
    .orderBy(cardioLogs.id);

  // Metadata for every exercise that appears in this session, so the client can
  // render a card without a second round-trip per exercise.
  const exerciseIds = Array.from(new Set([...sets.map((s) => s.exerciseId), ...cardio.map((c) => c.exerciseId)]));
  const exerciseMeta = exerciseIds.length
    ? await db.select().from(exercises).where(inArray(exercises.id, exerciseIds))
    : [];
  const metaById = new Map(
    exerciseMeta.map((e) => [
      e.id,
      {
        exerciseId: e.id,
        exerciseName: e.name,
        loadType: e.loadType,
        portable: e.portable,
        conditioningOnly: e.conditioningOnly,
        provenance: e.source,
        untagged: e.untagged,
        params: e.params,
      },
    ])
  );

  return NextResponse.json({
    id: log.clientSessionId,
    clientSessionId: log.clientSessionId,
    date: log.date,
    programDay: log.programDay,
    finishedAt: log.finishedAt,
    exercises: exerciseIds.map((id) => metaById.get(id)).filter(Boolean),
    sets,
    cardio,
  });
}
