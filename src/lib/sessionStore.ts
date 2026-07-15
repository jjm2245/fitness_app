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
  instanceId: string; // the performed occurrence this set belongs to (v2)
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

// "Done" now marks a specific occurrence (instance), since the same exercise
// can appear multiple times in one session.
export interface CompletedFlag {
  instanceId: string; // keyPath
  sessionId: string;
  completed: boolean;
}

// One performed occurrence in the ordered session list (v2). The same exercise
// can occur multiple times at different order_index (tricep → chest → tricep).
// The client-owned instanceId is the identity that maps to exactly one
// session_exercises row on sync.
export interface Occurrence {
  instanceId: string; // keyPath, client-generated
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  source: string; // where added from: "Legs + shoulders" | "block:Abs" | "Ad-hoc"
  provenance: string; // curated | library | custom
  untagged: boolean;
  orderIndex: number;
  // Program-day targets travel with the occurrence so the log screen is fully
  // self-contained per session (no /api/program round-trip). Null for
  // ad-hoc/block items with no prescribed target.
  targetSets: number | null;
  repRange: string | null;
  rirTarget: string | null;
  params: Record<string, unknown> | null;
  synced: boolean; // occurrence row pushed to the server
}

export type CardioSyncState = SetSyncState;

export interface SessionCardio {
  localId?: number;
  sessionId: string;
  instanceId: string;
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
  occurrences: { key: string; value: Occurrence; indexes: { "by-session": string } };
  sets: { key: number; value: SessionSet; indexes: { "by-session": string; "by-instance": string } };
  completed: { key: string; value: CompletedFlag; indexes: { "by-session": string } };
  cardio: { key: number; value: SessionCardio; indexes: { "by-session": string; "by-instance": string } };
}

let dbPromise: Promise<IDBPDatabase<SessionDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SessionDB>("fitness-app-session", 4, {
      upgrade(db) {
        // v4 introduces the ordered-occurrence model (session-model v2): sets and
        // cardio link to an occurrence (instanceId), the `composition` store is
        // replaced by `occurrences`, and `completed` is keyed by occurrence.
        // Destructive bump — unsynced local data is cleared; finished sessions
        // are safe on the server and reappear via GET /api/sessions.
        for (const name of ["sets", "completed", "meta", "composition", "occurrences", "cardio"]) {
          const stores = db.objectStoreNames as unknown as DOMStringList;
          if (stores.contains(name)) db.deleteObjectStore(name as never);
        }
        if (!(db.objectStoreNames as unknown as DOMStringList).contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id" });
        }
        const occ = db.createObjectStore("occurrences", { keyPath: "instanceId" });
        occ.createIndex("by-session", "sessionId");
        const sets = db.createObjectStore("sets", { keyPath: "localId", autoIncrement: true });
        sets.createIndex("by-session", "sessionId");
        sets.createIndex("by-instance", "instanceId");
        const completed = db.createObjectStore("completed", { keyPath: "instanceId" });
        completed.createIndex("by-session", "sessionId");
        const cardio = db.createObjectStore("cardio", { keyPath: "localId", autoIncrement: true });
        cardio.createIndex("by-session", "sessionId");
        cardio.createIndex("by-instance", "instanceId");
      },
    });
  }
  return dbPromise;
}

/** Test-only: close + delete the IndexedDB so each test starts from a clean
 * store (occurrences now sync, so leftover unsynced rows would otherwise leak
 * across tests via the shared fake-indexeddb). Not used in app code. */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("fitness-app-session");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
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
  exerciseCount: number; // performed occurrences (v2 — repeats count separately)
  setCount: number;
  cardioCount: number;
}

/**
 * Local sessions with performed counts, newest first. One pass over the
 * occurrences/sets/cardio stores rather than a query per session. Exercise
 * count is the number of performed occurrences (the ordered list length), so a
 * session reads the same before and after sync.
 */
export async function listLocalSessionSummaries(): Promise<LocalSessionSummary[]> {
  const db = await getDb();
  const [sessions, occurrences, sets, cardio] = await Promise.all([
    db.getAll("sessions"),
    db.getAll("occurrences"),
    db.getAll("sets"),
    db.getAll("cardio"),
  ]);

  const perSession = new Map<string, { occ: number; setCount: number; cardioCount: number }>();
  const bucket = (id: string) => {
    let b = perSession.get(id);
    if (!b) perSession.set(id, (b = { occ: 0, setCount: 0, cardioCount: 0 }));
    return b;
  };
  for (const o of occurrences) bucket(o.sessionId).occ += 1;
  for (const s of sets) if (s.syncState !== "pending_delete") bucket(s.sessionId).setCount += 1;
  for (const c of cardio) if (c.syncState !== "pending_delete") bucket(c.sessionId).cardioCount += 1;

  return sessions
    .map((s) => {
      const b = perSession.get(s.id);
      return {
        ...s,
        exerciseCount: b ? b.occ : 0,
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
  for (const o of await db.getAllFromIndex("occurrences", "by-session", id)) await db.delete("occurrences", o.instanceId);
  for (const f of await db.getAllFromIndex("completed", "by-session", id)) await db.delete("completed", f.instanceId);
}

// Offline-safe session delete (Part 3a). The local rows go immediately; a
// server-side delete is queued in localStorage (a tiny id list, no IndexedDB
// version bump) and drained by sync() — DELETE is idempotent, so a queued
// delete for a never-synced session is a harmless no-op on the server.
const DELETE_QUEUE_KEY = "fitness-app:pending-session-deletes";
function readDeleteQueue(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(DELETE_QUEUE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeDeleteQueue(ids: string[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DELETE_QUEUE_KEY, JSON.stringify([...new Set(ids)]));
}

export async function deleteSession(id: string): Promise<void> {
  await deleteLocalSession(id);
  writeDeleteQueue([...readDeleteQueue(), id]);
}

// Shape returned by GET /api/sessions/[id] — a whole server-side session.
export interface ServerSession {
  id: string;
  clientSessionId: string | null;
  date: string;
  programDay: string | null;
  finishedAt: string | null;
  // Ordered performed occurrences (session_exercises). For a legacy session with
  // no rows, the API synthesizes one occurrence per distinct logged exercise.
  exercises: Array<{
    sessionExerciseId: number | null;
    clientInstanceId: string | null;
    exerciseId: string;
    exerciseName: string;
    loadType: string;
    portable: boolean;
    conditioningOnly: boolean;
    provenance: string;
    untagged: boolean;
    params: Record<string, unknown> | null;
    orderIndex: number;
    source: string | null;
  }>;
  sets: Array<{
    id: number;
    sessionExerciseId: number | null;
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
    sessionExerciseId: number | null;
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
// Everything written lands as "synced" (occurrences) / with server ids (sets),
// so later edits/deletes route by server id exactly like locally-created rows.
// Sets link to occurrences by session_exercise id; a set with none (legacy)
// falls back to the first occurrence of its exercise.
export async function hydrateFromServer(server: ServerSession): Promise<LocalSession> {
  const db = await getDb();
  const existing = await db.get("sessions", server.id);
  if (existing) return existing;

  const nameOf = (id: string) => server.exercises.find((e) => e.exerciseId === id)?.exerciseName ?? id;

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

  // One occurrence per server row, preserving order. Map server occurrence id →
  // local instanceId so sets/cardio can be linked; also remember the first
  // occurrence per exercise for legacy sets with no link.
  const instByServerId = new Map<number, string>();
  const firstInstByExercise = new Map<string, string>();
  const sorted = [...server.exercises].sort((a, b) => a.orderIndex - b.orderIndex);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const instanceId = e.clientInstanceId ?? newId();
    if (e.sessionExerciseId != null) instByServerId.set(e.sessionExerciseId, instanceId);
    if (!firstInstByExercise.has(e.exerciseId)) firstInstByExercise.set(e.exerciseId, instanceId);
    const occ: Occurrence = {
      instanceId,
      sessionId: server.id,
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      loadType: e.loadType,
      portable: e.portable,
      conditioningOnly: e.conditioningOnly,
      source: e.source ?? session.origin,
      provenance: e.provenance,
      untagged: e.untagged,
      orderIndex: i,
      targetSets: null,
      repRange: null,
      rirTarget: null,
      params: e.params,
      synced: true,
    };
    await db.put("occurrences", occ);
  }

  const instanceFor = (exerciseId: string, sessionExerciseId: number | null): string =>
    (sessionExerciseId != null ? instByServerId.get(sessionExerciseId) : undefined) ??
    firstInstByExercise.get(exerciseId) ??
    newId();

  for (const s of server.sets) {
    await db.add("sets", {
      sessionId: server.id,
      instanceId: instanceFor(s.exerciseId, s.sessionExerciseId),
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
    });
  }

  for (const c of server.cardio) {
    await db.add("cardio", {
      sessionId: server.id,
      instanceId: instanceFor(c.exerciseId, c.sessionExerciseId),
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
    });
  }

  return session;
}

// --- Sets ------------------------------------------------------------------

export interface LogSetInput {
  sessionId: string;
  instanceId: string; // the occurrence this set belongs to
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
  // Set index is per-occurrence, so two occurrences of the same exercise each
  // number their sets from 1.
  const existing = await db.getAllFromIndex("sets", "by-instance", input.instanceId);
  const setIndex = existing.filter((s) => s.syncState !== "pending_delete").length + 1;

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

// --- Completed-occurrence flags (local only) -------------------------------

export async function setOccurrenceCompleted(sessionId: string, instanceId: string, completed: boolean): Promise<void> {
  const db = await getDb();
  await db.put("completed", { instanceId, sessionId, completed });
}

export async function getCompletedInstances(sessionId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("completed", "by-session", sessionId);
  return new Set(rows.filter((r) => r.completed).map((r) => r.instanceId));
}

// --- Occurrences (the ordered performed list, v2) --------------------------

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

/** Append one performed occurrence to the session (repeats allowed). Returns it.
 * Recomputes the session's aggregated name from its occurrence sources. */
export async function addOccurrence(sessionId: string, item: AttachExercise, source: string): Promise<Occurrence> {
  const db = await getDb();
  const existing = await db.getAllFromIndex("occurrences", "by-session", sessionId);
  const orderIndex = existing.reduce((m, o) => Math.max(m, o.orderIndex + 1), 0);
  const occ: Occurrence = {
    instanceId: newId(),
    sessionId,
    source,
    orderIndex,
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
    synced: false,
  };
  await db.put("occurrences", occ);
  await recomputeSessionName(sessionId);
  return occ;
}

export async function listOccurrences(sessionId: string): Promise<Occurrence[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("occurrences", "by-session", sessionId);
  return rows.sort((a, b) => a.orderIndex - b.orderIndex);
}

/** Move an occurrence up/down by swapping order_index with its neighbor. */
export async function moveOccurrence(sessionId: string, instanceId: string, dir: "up" | "down"): Promise<void> {
  const db = await getDb();
  const ordered = await listOccurrences(sessionId);
  const i = ordered.findIndex((o) => o.instanceId === instanceId);
  if (i === -1) return;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ordered.length) return;
  const a = ordered[i];
  const b = ordered[j];
  await db.put("occurrences", { ...a, orderIndex: b.orderIndex, synced: false });
  await db.put("occurrences", { ...b, orderIndex: a.orderIndex, synced: false });
}

/** Remove an occurrence and everything hanging off it (for an accidental add). */
export async function removeOccurrence(sessionId: string, instanceId: string): Promise<void> {
  const db = await getDb();
  await db.delete("occurrences", instanceId);
  await db.delete("completed", instanceId);
  for (const s of await db.getAllFromIndex("sets", "by-instance", instanceId)) {
    // A synced set needs a server delete; an unsynced one can just vanish.
    if (s.serverId != null) await db.put("sets", { ...s, syncState: "pending_delete" });
    else if (s.localId != null) await db.delete("sets", s.localId);
  }
  for (const c of await db.getAllFromIndex("cardio", "by-instance", instanceId)) {
    if (c.serverId != null) await db.put("cardio", { ...c, syncState: "pending_delete" });
    else if (c.localId != null) await db.delete("cardio", c.localId);
  }
  // The occurrence sync loop skips a session whose occurrences are *all* synced.
  // Deleting one leaves the survivors untouched (still synced), so without this
  // the shortened list is never re-POSTed and the removed occurrence lingers on
  // the server forever — inflating its exercise count so the sessions list shows
  // a permanent, false "not synced" while sync honestly reports success (the
  // third sync-adjacent data-integrity bug). Dirtying a survivor forces the next
  // sync to push the shortened list, which the server upsert then prunes.
  const survivors = await db.getAllFromIndex("occurrences", "by-session", sessionId);
  if (survivors.length) {
    const s0 = survivors[0];
    if (s0.synced) await db.put("occurrences", { ...s0, synced: false });
  }
  await recomputeSessionName(sessionId);
}

// The session name reflects every contributing source, in the order they first
// appeared ("Legs + shoulders" → add abs → "Legs + shoulders + abs"). Ad-hoc
// picks contribute "Ad-hoc". Persisted onto the session so the list + finish
// label read it without recomputing.
export async function recomputeSessionName(sessionId: string): Promise<void> {
  const db = await getDb();
  const session = await db.get("sessions", sessionId);
  if (!session) return;
  const occ = await listOccurrences(sessionId);
  const seen: string[] = [];
  for (const o of occ) {
    const label = (o.source || "Ad-hoc").trim();
    if (!seen.includes(label)) seen.push(label);
  }
  const origin = seen.length ? seen.join(" + ") : "New session";
  if (origin !== session.origin) await db.put("sessions", { ...session, origin });
}

// --- Cardio ----------------------------------------------------------------

export interface LogCardioInput {
  sessionId: string;
  instanceId: string;
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
  // Why the outbox didn't fully drain, so the UI can say something true instead
  // of a silent "not synced". `authError` means the session cookie expired
  // (re-login needed); the drain aborts on it since every request would 401.
  authError: boolean;
  networkError: boolean;
  serverError: boolean;
}

type SyncErrKind = "auth" | "network" | "server";
type SyncErr = { kind: SyncErrKind };
function isSyncErr(e: unknown): e is SyncErr {
  return typeof e === "object" && e !== null && "kind" in e;
}

// Single choke point that turns HTTP/network outcomes into typed sync errors.
// A 401 (proxy, expired session) is auth; a thrown fetch is network; any other
// non-ok (except an allowed 404 on delete) is server.
async function send(url: string, init: RequestInit, allow404 = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw { kind: "network" } as SyncErr;
  }
  if (res.status === 401) throw { kind: "auth" } as SyncErr;
  if (res.status === 404 && allow404) return res;
  if (!res.ok) throw { kind: "server" } as SyncErr;
  return res;
}

export async function pendingCount(sessionId?: string): Promise<number> {
  const db = await getDb();
  const setRows = sessionId ? await db.getAllFromIndex("sets", "by-session", sessionId) : await db.getAll("sets");
  let n = setRows.filter((s) => s.syncState !== "synced").length;

  const cardioRows = sessionId ? await db.getAllFromIndex("cardio", "by-session", sessionId) : await db.getAll("cardio");
  n += cardioRows.filter((c) => c.syncState !== "synced").length;

  // An unsynced occurrence (e.g. added but not yet logged, or reordered) is a
  // pending change too — the ordered list must reach the server.
  const occRows = sessionId ? await db.getAllFromIndex("occurrences", "by-session", sessionId) : await db.getAll("occurrences");
  n += occRows.filter((o) => !o.synced).length;

  const sessions = sessionId ? [await db.get("sessions", sessionId)] : await db.getAll("sessions");
  for (const s of sessions) if (s && s.finishedAt && !s.finishSynced) n += 1;

  // Queued server-side deletes are pending changes too.
  const dq = readDeleteQueue();
  n += sessionId ? (dq.includes(sessionId) ? 1 : 0) : dq.length;
  return n;
}

// Serialize sync: concurrent callers (e.g. two rapid set logs each firing
// onSessionChanged) would otherwise both read the same pending rows and
// double-POST — set-logs is a plain insert, so that duplicates logged sets.
// Chaining each drain after the previous makes the second run see the outbox
// already emptied. Data-integrity fix, discovered via rapid logging.
let syncChain: Promise<unknown> = Promise.resolve();
export function sync(): Promise<SyncResult> {
  const run = syncChain.then(() => runSync());
  syncChain = run.catch(() => {});
  return run;
}

async function runSync(): Promise<SyncResult> {
  const db = await getDb();
  const result: SyncResult = {
    created: 0, updated: 0, deleted: 0, finished: 0, failed: 0,
    authError: false, networkError: false, serverError: false,
  };

  // Record a failure; return true when the caller should abort the whole drain
  // (auth — every subsequent request would 401 too, so stop and prompt login).
  const record = (e: unknown): boolean => {
    if (isSyncErr(e) && e.kind === "auth") {
      result.authError = true;
      return true;
    }
    result.failed += 1;
    if (isSyncErr(e) && e.kind === "network") result.networkError = true;
    else result.serverError = true;
    return false;
  };

  const jsonHeaders = { "Content-Type": "application/json" };

  // Occurrences first — the ordered performed list must exist server-side so the
  // set/cardio POSTs can link to session_exercise rows by client_instance_id.
  // One upsert per session pushes its whole ordered list (idempotent).
  const allSessions = await db.getAll("sessions");
  const sessionById = new Map(allSessions.map((s) => [s.id, s]));
  const occBySession = new Map<string, Occurrence[]>();
  for (const o of await db.getAll("occurrences")) {
    (occBySession.get(o.sessionId) ?? occBySession.set(o.sessionId, []).get(o.sessionId)!).push(o);
  }
  for (const [sid, occs] of occBySession) {
    if (occs.every((o) => o.synced)) continue;
    const s = sessionById.get(sid);
    if (!s) continue;
    try {
      await send("/api/session-exercises", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          clientSessionId: sid,
          date: s.date,
          programDay: s.origin,
          exercises: [...occs]
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((o) => ({ clientInstanceId: o.instanceId, exerciseId: o.exerciseId, orderIndex: o.orderIndex, source: o.source })),
        }),
      });
      for (const o of occs) await db.put("occurrences", { ...o, synced: true });
    } catch (e) {
      if (record(e)) return result;
    }
  }

  for (const row of await db.getAll("sets")) {
    try {
      if (row.syncState === "pending_create") {
        const res = await send("/api/set-logs", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            clientSessionId: row.sessionId,
            instanceId: row.instanceId,
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
        const created = await res.json();
        await db.put("sets", { ...row, serverId: created.id, syncState: "synced" });
        result.created += 1;
      } else if (row.syncState === "pending_update" && row.serverId != null) {
        await send(`/api/set-logs/${row.serverId}`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ load: row.load, reps: row.reps, effort: row.effort, rir: row.rir, setType: row.setType }),
        });
        await db.put("sets", { ...row, syncState: "synced" });
        result.updated += 1;
      } else if (row.syncState === "pending_delete") {
        if (row.serverId != null) {
          await send(`/api/set-logs/${row.serverId}`, { method: "DELETE" }, true);
        }
        if (row.localId != null) await db.delete("sets", row.localId);
        result.deleted += 1;
      }
    } catch (e) {
      if (record(e)) return result;
    }
  }

  for (const row of await db.getAll("cardio")) {
    try {
      if (row.syncState === "pending_create") {
        const res = await send("/api/cardio-logs", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            clientSessionId: row.sessionId,
            instanceId: row.instanceId,
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
        const created = await res.json();
        await db.put("cardio", { ...row, serverId: created.id, syncState: "synced" });
        result.created += 1;
      } else if (row.syncState === "pending_delete") {
        if (row.serverId != null) {
          await send(`/api/cardio-logs/${row.serverId}`, { method: "DELETE" }, true);
        }
        if (row.localId != null) await db.delete("cardio", row.localId);
        result.deleted += 1;
      }
    } catch (e) {
      if (record(e)) return result;
    }
  }

  for (const s of await db.getAll("sessions")) {
    if (!s.finishedAt || s.finishSynced) continue;
    try {
      await send("/api/sessions/finish", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          clientSessionId: s.id,
          date: s.date,
          programDay: s.origin,
          finishedAt: s.finishedAt,
        }),
      });
      await db.put("sessions", { ...s, finishSynced: true });
      result.finished += 1;
    } catch (e) {
      if (record(e)) return result;
    }
  }

  // Drain queued session deletes (Part 3a). DELETE is idempotent, so a never-
  // synced session's queued delete just no-ops server-side.
  for (const delId of readDeleteQueue()) {
    try {
      await send(`/api/sessions/${encodeURIComponent(delId)}`, { method: "DELETE" }, true);
      writeDeleteQueue(readDeleteQueue().filter((x) => x !== delId));
      result.deleted += 1;
    } catch (e) {
      if (record(e)) return result;
    }
  }

  return result;
}
