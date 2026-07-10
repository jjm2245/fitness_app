"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Durable local session log (replaces the old drain-and-forget outbox). Every
// logged set is a permanent local row that survives reload and sync — the UI
// always reads from here, never from a network round-trip, so confirmation,
// edit, delete, the completed-exercise state, and the finish summary all work
// fully offline. Syncing updates rows in place rather than deleting them.

export type SetSyncState = "pending_create" | "synced" | "pending_update" | "pending_delete";

export interface SessionSet {
  localId?: number;
  date: string; // ISO date (session identity)
  exerciseId: string;
  exerciseName: string; // denormalized so the logged list renders offline
  machineId: string | null;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  rir: number | null;
  serverId: number | null; // set_logs.id once synced
  syncState: SetSyncState;
}

export interface CompletedFlag {
  key: string; // `${date}::${exerciseId}`
  date: string;
  exerciseId: string;
  completed: boolean;
}

export interface SessionMeta {
  date: string;
  finishedAt: string | null; // ISO instant, stamped on "Finish session"
  finishSynced: boolean;
}

interface SessionDB extends DBSchema {
  sets: {
    key: number;
    value: SessionSet;
    indexes: { "by-date": string };
  };
  completed: {
    key: string;
    value: CompletedFlag;
    indexes: { "by-date": string };
  };
  meta: {
    key: string;
    value: SessionMeta;
  };
}

let dbPromise: Promise<IDBPDatabase<SessionDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SessionDB>("fitness-app-session", 1, {
      upgrade(db) {
        const sets = db.createObjectStore("sets", { keyPath: "localId", autoIncrement: true });
        sets.createIndex("by-date", "date");
        const completed = db.createObjectStore("completed", { keyPath: "key" });
        completed.createIndex("by-date", "date");
        db.createObjectStore("meta", { keyPath: "date" });
      },
    });
  }
  return dbPromise;
}

function completedKey(date: string, exerciseId: string) {
  return `${date}::${exerciseId}`;
}

// --- Sets ------------------------------------------------------------------

export interface LogSetInput {
  date: string;
  exerciseId: string;
  exerciseName: string;
  machineId: string | null;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  rir: number | null;
}

export async function logSet(input: LogSetInput): Promise<SessionSet> {
  const db = await getDb();
  const existing = await db.getAllFromIndex("sets", "by-date", input.date);
  const setIndex =
    existing.filter((s) => s.exerciseId === input.exerciseId && s.syncState !== "pending_delete")
      .length + 1;

  const row: SessionSet = {
    ...input,
    setIndex,
    serverId: null,
    syncState: "pending_create",
  };
  const localId = await db.add("sets", row);
  return { ...row, localId };
}

/** Sets visible for a session — excludes soft-deleted ones, oldest first. */
export async function getSessionSets(date: string): Promise<SessionSet[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("sets", "by-date", date);
  return rows
    .filter((s) => s.syncState !== "pending_delete")
    .sort((a, b) => (a.localId ?? 0) - (b.localId ?? 0));
}

/**
 * Edit a set's numbers. Works offline regardless of whether the set has already
 * synced — this is the same-session fat-finger-correction case. A synced row
 * transitions to pending_update so the next sync PATCHes the server.
 */
export async function editSet(
  localId: number,
  patch: { load?: number; reps?: number; rir?: number | null; setType?: "warmup" | "working" }
): Promise<void> {
  const db = await getDb();
  const row = await db.get("sets", localId);
  if (!row) return;

  const updated: SessionSet = {
    ...row,
    ...patch,
    syncState: row.syncState === "pending_create" ? "pending_create" : "pending_update",
  };
  await db.put("sets", updated);
}

/**
 * Delete a set. If it never synced, it's hard-removed and never touches the
 * server. If it synced, it's soft-marked pending_delete (hidden immediately)
 * and DELETEd from the server on the next sync.
 */
export async function deleteSet(localId: number): Promise<void> {
  const db = await getDb();
  const row = await db.get("sets", localId);
  if (!row) return;

  if (row.syncState === "pending_create") {
    await db.delete("sets", localId);
  } else {
    await db.put("sets", { ...row, syncState: "pending_delete" });
  }
}

// --- Completed-exercise flags (local only) ---------------------------------

export async function setExerciseCompleted(
  date: string,
  exerciseId: string,
  completed: boolean
): Promise<void> {
  const db = await getDb();
  await db.put("completed", { key: completedKey(date, exerciseId), date, exerciseId, completed });
}

export async function getCompletedExercises(date: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("completed", "by-date", date);
  return new Set(rows.filter((r) => r.completed).map((r) => r.exerciseId));
}

// --- Session meta / finish -------------------------------------------------

export async function getSessionMeta(date: string): Promise<SessionMeta | null> {
  const db = await getDb();
  return (await db.get("meta", date)) ?? null;
}

/** Stamp the session finished. Re-callable — re-stamps finishedAt, never locks. */
export async function finishSession(date: string): Promise<SessionMeta> {
  const db = await getDb();
  const meta: SessionMeta = { date, finishedAt: new Date().toISOString(), finishSynced: false };
  await db.put("meta", meta);
  return meta;
}

// --- Sync ------------------------------------------------------------------

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  finished: number;
  failed: number;
}

export async function pendingCount(date?: string): Promise<number> {
  const db = await getDb();
  const rows = date ? await db.getAllFromIndex("sets", "by-date", date) : await db.getAll("sets");
  let n = rows.filter((s) => s.syncState !== "synced").length;

  const metas = date ? [await db.get("meta", date)] : await db.getAll("meta");
  for (const m of metas) {
    if (m && m.finishedAt && !m.finishSynced) n += 1;
  }
  return n;
}

export async function sync(): Promise<SyncResult> {
  const db = await getDb();
  const result: SyncResult = { created: 0, updated: 0, deleted: 0, finished: 0, failed: 0 };

  const rows = await db.getAll("sets");
  for (const row of rows) {
    try {
      if (row.syncState === "pending_create") {
        const res = await fetch("/api/set-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: row.date,
            exerciseId: row.exerciseId,
            machineId: row.machineId,
            setIndex: row.setIndex,
            setType: row.setType,
            load: row.load,
            reps: row.reps,
            rir: row.rir,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const created = await res.json();
        await db.put("sets", { ...row, serverId: created.id, syncState: "synced" });
        result.created += 1;
      } else if (row.syncState === "pending_update" && row.serverId != null) {
        const res = await fetch(`/api/set-logs/${row.serverId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ load: row.load, reps: row.reps, rir: row.rir, setType: row.setType }),
        });
        if (!res.ok) throw new Error(String(res.status));
        await db.put("sets", { ...row, syncState: "synced" });
        result.updated += 1;
      } else if (row.syncState === "pending_delete") {
        if (row.serverId != null) {
          const res = await fetch(`/api/set-logs/${row.serverId}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw new Error(String(res.status));
        }
        if (row.localId != null) await db.delete("sets", row.localId);
        result.deleted += 1;
      }
    } catch {
      result.failed += 1; // stays in its pending state, retried next sync
    }
  }

  const metas = await db.getAll("meta");
  for (const meta of metas) {
    if (!meta.finishedAt || meta.finishSynced) continue;
    try {
      const res = await fetch("/api/sessions/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: meta.date, finishedAt: meta.finishedAt }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await db.put("meta", { ...meta, finishSynced: true });
      result.finished += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
