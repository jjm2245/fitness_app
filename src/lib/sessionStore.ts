"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Durable local session log. A "session" is now a first-class thing you start
// (a client-generated id), not a calendar day — so two sessions can share a
// date. Everything (sets, cardio, composition, completed flags) is keyed by
// that session id. The UI always reads from here, never a network round-trip,
// so the sessions list, logging, edit/delete, and finish all work fully
// offline; sync updates rows in place. See DECISIONS.md (Part A).

export type SetSyncState = "pending_create" | "synced" | "pending_update" | "pending_delete";
export type EffortTag = "more_in_me" | "near_failure" | "to_failure";

// A local session record. `finishedAt` is stamped on finish; the row is filed
// into the sessions list whether or not it has synced yet.
export interface LocalSession {
  id: string; // client-generated session id
  date: string; // ISO date the session belongs to
  origin: string; // short description: program day name, or "Ad-hoc"
  programId: number | null;
  createdAt: string; // ISO
  finishedAt: string | null; // ISO instant, stamped on "Finish session"
  finishSynced: boolean;
}

export interface SessionSet {
  localId?: number;
  sessionId: string;
  date: string; // the session's date (denormalized for the workout_log)
  exerciseId: string;
  exerciseName: string;
  machineId: string | null;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  effort: EffortTag | null;
  rir: number | null;
  serverId: number | null;
  syncState: SetSyncState;
}

export interface CompletedFlag {
  key: string; // `${sessionId}::${exerciseId}`
  sessionId: string;
  exerciseId: string;
  completed: boolean;
}

export interface CompositionItem {
  key: string; // `${sessionId}::${exerciseId}`
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  source: string; // origin in the session: "block:Cardio" | "PPL·legs" | "adhoc"
  provenance: string; // curated | library | custom
  untagged: boolean;
  orderIndex: number;
  // Program-day targets travel with the item so the log screen is fully
  // self-contained per session (no /api/program round-trip). Null for
  // ad-hoc/block items with no prescribed target.
  targetSets: number | null;
  repRange: string | null;
  rirTarget: string | null;
  params: Record<string, unknown> | null;
}

export type CardioSyncState = SetSyncState;

export interface SessionCardio {
  localId?: number;
  sessionId: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  durationMin: number | null;
  incline: number | null;
  speed: number | null;
  distance: number | null;
  level: number | null;
  notes: string | null;
  serverId: number | null;
  syncState: CardioSyncState;
}

interface SessionDB extends DBSchema {
  sessions: { key: string; value: LocalSession };
  sets: { key: number; value: SessionSet; indexes: { "by-session": string } };
  completed: { key: string; value: CompletedFlag; indexes: { "by-session": string } };
  composition: { key: string; value: CompositionItem; indexes: { "by-session": string } };
  cardio: { key: number; value: SessionCardio; indexes: { "by-session": string } };
}

let dbPromise: Promise<IDBPDatabase<SessionDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SessionDB>("fitness-app-session", 3, {
      upgrade(db, oldVersion) {
        // v3 re-keys the whole store from date → sessionId. The old date-keyed
        // stores are dropped and recreated; any *unsynced* local session data
        // is cleared by this one-time bump (finished sessions are safe on the
        // server and reappear via GET /api/sessions). See DECISIONS.md.
        // Legacy (date-keyed) store names, some no longer in the typed schema
        // (e.g. "meta") — cast through the raw name list to drop them.
        for (const name of ["sets", "completed", "meta", "composition", "cardio"]) {
          const stores = db.objectStoreNames as unknown as DOMStringList;
          if (stores.contains(name)) db.deleteObjectStore(name as never);
        }
        db.createObjectStore("sessions", { keyPath: "id" });
        const sets = db.createObjectStore("sets", { keyPath: "localId", autoIncrement: true });
        sets.createIndex("by-session", "sessionId");
        const completed = db.createObjectStore("completed", { keyPath: "key" });
        completed.createIndex("by-session", "sessionId");
        const composition = db.createObjectStore("composition", { keyPath: "key" });
        composition.createIndex("by-session", "sessionId");
        const cardio = db.createObjectStore("cardio", { keyPath: "localId", autoIncrement: true });
        cardio.createIndex("by-session", "sessionId");
        void oldVersion;
      },
    });
  }
  return dbPromise;
}

function compKey(sessionId: string, exerciseId: string) {
  return `${sessionId}::${exerciseId}`;
}

// --- Sessions --------------------------------------------------------------

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateSessionInput {
  date: string;
  origin: string;
  programId: number | null;
}

export async function createSession(input: CreateSessionInput): Promise<LocalSession> {
  const db = await getDb();
  const session: LocalSession = {
    id: newId(),
    date: input.date,
    origin: input.origin,
    programId: input.programId,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    finishSynced: false,
  };
  await db.put("sessions", session);
  return session;
}

export async function getSession(id: string): Promise<LocalSession | null> {
  const db = await getDb();
  return (await db.get("sessions", id)) ?? null;
}

/** All local sessions, newest first (for the sessions list). */
export async function listLocalSessions(): Promise<LocalSession[]> {
  const db = await getDb();
  const rows = await db.getAll("sessions");
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface LocalSessionSummary extends LocalSession {
  exerciseCount: number; // distinct exercises with logged sets or cardio
  setCount: number;
  cardioCount: number;
}

/**
 * Local sessions with logged-volume counts, newest first. One pass over the
 * sets/cardio stores rather than a query per session, so the list renders from
 * a couple of reads. Exercise count mirrors the server's (distinct logged
 * exercises), so a session reads the same before and after sync.
 */
export async function listLocalSessionSummaries(): Promise<LocalSessionSummary[]> {
  const db = await getDb();
  const [sessions, sets, cardio] = await Promise.all([
    db.getAll("sessions"),
    db.getAll("sets"),
    db.getAll("cardio"),
  ]);

  const perSession = new Map<string, { ex: Set<string>; setCount: number; cardioCount: number }>();
  const bucket = (id: string) => {
    let b = perSession.get(id);
    if (!b) perSession.set(id, (b = { ex: new Set(), setCount: 0, cardioCount: 0 }));
    return b;
  };
  for (const s of sets) {
    if (s.syncState === "pending_delete") continue;
    const b = bucket(s.sessionId);
    b.ex.add(s.exerciseId);
    b.setCount += 1;
  }
  for (const c of cardio) {
    if (c.syncState === "pending_delete") continue;
    const b = bucket(c.sessionId);
    b.ex.add(c.exerciseId);
    b.cardioCount += 1;
  }

  return sessions
    .map((s) => {
      const b = perSession.get(s.id);
      return {
        ...s,
        exerciseCount: b ? b.ex.size : 0,
        setCount: b ? b.setCount : 0,
        cardioCount: b ? b.cardioCount : 0,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Stamp finished. Re-callable — re-stamps, never locks. */
export async function finishSession(id: string): Promise<LocalSession | null> {
  const db = await getDb();
  const s = await db.get("sessions", id);
  if (!s) return null;
  const updated: LocalSession = { ...s, finishedAt: new Date().toISOString(), finishSynced: false };
  await db.put("sessions", updated);
  return updated;
}

export async function deleteLocalSession(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("sessions", id);
  for (const s of await db.getAllFromIndex("sets", "by-session", id)) if (s.localId != null) await db.delete("sets", s.localId);
  for (const c of await db.getAllFromIndex("cardio", "by-session", id)) if (c.localId != null) await db.delete("cardio", c.localId);
  for (const co of await db.getAllFromIndex("composition", "by-session", id)) await db.delete("composition", co.key);
  for (const f of await db.getAllFromIndex("completed", "by-session", id)) await db.delete("completed", f.key);
}

// Shape returned by GET /api/sessions/[id] — a whole server-side session.
export interface ServerSession {
  id: string;
  clientSessionId: string | null;
  date: string;
  programDay: string | null;
  finishedAt: string | null;
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    loadType: string;
    portable: boolean;
    conditioningOnly: boolean;
    provenance: string;
    untagged: boolean;
    params: Record<string, unknown> | null;
  }>;
  sets: Array<{
    id: number;
    exerciseId: string;
    machineId: string | null;
    setIndex: number;
    setType: "warmup" | "working";
    load: string;
    reps: number;
    effort: EffortTag | null;
    rir: string | null;
  }>;
  cardio: Array<{
    id: number;
    exerciseId: string;
    durationMin: string | null;
    incline: string | null;
    speed: string | null;
    distance: string | null;
    level: string | null;
    notes: string | null;
  }>;
}

// Rebuild a session's local rows from the server. Only runs when the session
// isn't already local — a session with unsynced local edits is never clobbered.
// Everything written lands as "synced" (with server ids) so later edits/deletes
// route by server id exactly like locally-created rows. This is what makes
// opening an old, synced-only session editable (it needs connectivity to fetch,
// then works offline). Returns the hydrated LocalSession, or the existing one.
export async function hydrateFromServer(server: ServerSession): Promise<LocalSession> {
  const db = await getDb();
  const existing = await db.get("sessions", server.id);
  if (existing) return existing;

  const meta = new Map(server.exercises.map((e) => [e.exerciseId, e]));
  const nameOf = (id: string) => meta.get(id)?.exerciseName ?? id;

  const session: LocalSession = {
    id: server.id,
    date: server.date,
    origin: server.programDay?.trim() || "Ad-hoc",
    programId: null,
    createdAt: server.finishedAt ?? new Date().toISOString(),
    finishedAt: server.finishedAt,
    finishSynced: true,
  };
  await db.put("sessions", session);

  // Composition: one item per distinct exercise, so each renders as a card.
  let order = 0;
  for (const e of server.exercises) {
    await db.put("composition", {
      key: compKey(server.id, e.exerciseId),
      sessionId: server.id,
      source: session.origin,
      orderIndex: order++,
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      loadType: e.loadType,
      portable: e.portable,
      conditioningOnly: e.conditioningOnly,
      provenance: e.provenance,
      untagged: e.untagged,
      targetSets: null,
      repRange: null,
      rirTarget: null,
      params: e.params,
    });
  }

  for (const s of server.sets) {
    const row: SessionSet = {
      sessionId: server.id,
      date: server.date,
      exerciseId: s.exerciseId,
      exerciseName: nameOf(s.exerciseId),
      machineId: s.machineId,
      setIndex: s.setIndex,
      setType: s.setType,
      load: Number(s.load),
      reps: s.reps,
      effort: s.effort,
      rir: s.rir != null ? Number(s.rir) : null,
      serverId: s.id,
      syncState: "synced",
    };
    await db.add("sets", row);
  }

  for (const c of server.cardio) {
    const row: SessionCardio = {
      sessionId: server.id,
      date: server.date,
      exerciseId: c.exerciseId,
      exerciseName: nameOf(c.exerciseId),
      durationMin: c.durationMin != null ? Number(c.durationMin) : null,
      incline: c.incline != null ? Number(c.incline) : null,
      speed: c.speed != null ? Number(c.speed) : null,
      distance: c.distance != null ? Number(c.distance) : null,
      level: c.level != null ? Number(c.level) : null,
      notes: c.notes,
      serverId: c.id,
      syncState: "synced",
    };
    await db.add("cardio", row);
  }

  return session;
}

// --- Sets ------------------------------------------------------------------

export interface LogSetInput {
  sessionId: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  machineId: string | null;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  effort: EffortTag | null;
  rir: number | null;
}

export async function logSet(input: LogSetInput): Promise<SessionSet> {
  const db = await getDb();
  const existing = await db.getAllFromIndex("sets", "by-session", input.sessionId);
  const setIndex =
    existing.filter((s) => s.exerciseId === input.exerciseId && s.syncState !== "pending_delete").length + 1;

  const row: SessionSet = { ...input, setIndex, serverId: null, syncState: "pending_create" };
  const localId = await db.add("sets", row);
  return { ...row, localId };
}

export async function getSessionSets(sessionId: string): Promise<SessionSet[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("sets", "by-session", sessionId);
  return rows.filter((s) => s.syncState !== "pending_delete").sort((a, b) => (a.localId ?? 0) - (b.localId ?? 0));
}

export async function editSet(
  localId: number,
  patch: { load?: number; reps?: number; rir?: number | null; effort?: EffortTag | null; setType?: "warmup" | "working" }
): Promise<void> {
  const db = await getDb();
  const row = await db.get("sets", localId);
  if (!row) return;
  await db.put("sets", {
    ...row,
    ...patch,
    syncState: row.syncState === "pending_create" ? "pending_create" : "pending_update",
  });
}

export async function deleteSet(localId: number): Promise<void> {
  const db = await getDb();
  const row = await db.get("sets", localId);
  if (!row) return;
  if (row.syncState === "pending_create") await db.delete("sets", localId);
  else await db.put("sets", { ...row, syncState: "pending_delete" });
}

// --- Completed-exercise flags (local only) ---------------------------------

export async function setExerciseCompleted(sessionId: string, exerciseId: string, completed: boolean): Promise<void> {
  const db = await getDb();
  await db.put("completed", { key: compKey(sessionId, exerciseId), sessionId, exerciseId, completed });
}

export async function getCompletedExercises(sessionId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("completed", "by-session", sessionId);
  return new Set(rows.filter((r) => r.completed).map((r) => r.exerciseId));
}

// --- Session composition (attached blocks / ad-hoc exercises, local only) ---

export interface AttachExercise {
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  provenance: string;
  untagged: boolean;
  targetSets?: number | null;
  repRange?: string | null;
  rirTarget?: string | null;
  params?: Record<string, unknown> | null;
}

export async function attachToComposition(sessionId: string, items: AttachExercise[], source: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getAllFromIndex("composition", "by-session", sessionId);
  let order = existing.length;
  for (const item of items) {
    const key = compKey(sessionId, item.exerciseId);
    if (await db.get("composition", key)) continue;
    await db.put("composition", {
      key,
      sessionId,
      source,
      orderIndex: order++,
      exerciseId: item.exerciseId,
      exerciseName: item.exerciseName,
      loadType: item.loadType,
      portable: item.portable,
      conditioningOnly: item.conditioningOnly,
      provenance: item.provenance,
      untagged: item.untagged,
      targetSets: item.targetSets ?? null,
      repRange: item.repRange ?? null,
      rirTarget: item.rirTarget ?? null,
      params: item.params ?? null,
    });
  }
}

export async function getSessionComposition(sessionId: string): Promise<CompositionItem[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("composition", "by-session", sessionId);
  return rows.sort((a, b) => a.orderIndex - b.orderIndex);
}

export async function removeFromComposition(sessionId: string, exerciseId: string): Promise<void> {
  const db = await getDb();
  await db.delete("composition", compKey(sessionId, exerciseId));
}

// --- Cardio ----------------------------------------------------------------

export interface LogCardioInput {
  sessionId: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  durationMin: number | null;
  incline: number | null;
  speed: number | null;
  distance: number | null;
  level: number | null;
  notes: string | null;
}

export async function logCardio(input: LogCardioInput): Promise<SessionCardio> {
  const db = await getDb();
  const row: SessionCardio = { ...input, serverId: null, syncState: "pending_create" };
  const localId = await db.add("cardio", row);
  return { ...row, localId };
}

export async function getSessionCardio(sessionId: string): Promise<SessionCardio[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("cardio", "by-session", sessionId);
  return rows.filter((c) => c.syncState !== "pending_delete").sort((a, b) => (a.localId ?? 0) - (b.localId ?? 0));
}

export async function deleteCardio(localId: number): Promise<void> {
  const db = await getDb();
  const row = await db.get("cardio", localId);
  if (!row) return;
  if (row.syncState === "pending_create") await db.delete("cardio", localId);
  else await db.put("cardio", { ...row, syncState: "pending_delete" });
}

// --- Sync ------------------------------------------------------------------

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  finished: number;
  failed: number;
}

export async function pendingCount(sessionId?: string): Promise<number> {
  const db = await getDb();
  const setRows = sessionId ? await db.getAllFromIndex("sets", "by-session", sessionId) : await db.getAll("sets");
  let n = setRows.filter((s) => s.syncState !== "synced").length;

  const cardioRows = sessionId ? await db.getAllFromIndex("cardio", "by-session", sessionId) : await db.getAll("cardio");
  n += cardioRows.filter((c) => c.syncState !== "synced").length;

  const sessions = sessionId ? [await db.get("sessions", sessionId)] : await db.getAll("sessions");
  for (const s of sessions) if (s && s.finishedAt && !s.finishSynced) n += 1;
  return n;
}

export async function sync(): Promise<SyncResult> {
  const db = await getDb();
  const result: SyncResult = { created: 0, updated: 0, deleted: 0, finished: 0, failed: 0 };

  for (const row of await db.getAll("sets")) {
    try {
      if (row.syncState === "pending_create") {
        const res = await fetch("/api/set-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientSessionId: row.sessionId,
            date: row.date,
            exerciseId: row.exerciseId,
            machineId: row.machineId,
            setIndex: row.setIndex,
            setType: row.setType,
            load: row.load,
            reps: row.reps,
            effort: row.effort,
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
          body: JSON.stringify({ load: row.load, reps: row.reps, effort: row.effort, rir: row.rir, setType: row.setType }),
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
      result.failed += 1;
    }
  }

  for (const row of await db.getAll("cardio")) {
    try {
      if (row.syncState === "pending_create") {
        const res = await fetch("/api/cardio-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientSessionId: row.sessionId,
            date: row.date,
            exerciseId: row.exerciseId,
            durationMin: row.durationMin,
            incline: row.incline,
            speed: row.speed,
            distance: row.distance,
            level: row.level,
            notes: row.notes,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const created = await res.json();
        await db.put("cardio", { ...row, serverId: created.id, syncState: "synced" });
        result.created += 1;
      } else if (row.syncState === "pending_delete") {
        if (row.serverId != null) {
          const res = await fetch(`/api/cardio-logs/${row.serverId}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw new Error(String(res.status));
        }
        if (row.localId != null) await db.delete("cardio", row.localId);
        result.deleted += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  for (const s of await db.getAll("sessions")) {
    if (!s.finishedAt || s.finishSynced) continue;
    try {
      const res = await fetch("/api/sessions/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSessionId: s.id,
          date: s.date,
          programDay: s.origin,
          finishedAt: s.finishedAt,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await db.put("sessions", { ...s, finishSynced: true });
      result.finished += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
