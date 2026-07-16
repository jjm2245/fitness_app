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
// Where a rest value came from. Honest-unknown model: a set with restSeconds null
// has UNKNOWN rest — we never fabricate a number (the LLM must never read
// invented rests). timed = rest timer (exact); derived = gap heuristic; user =
// manual correction (highest trust).
export type RestSource = "timed" | "derived" | "user";
export type SetSide = "left" | "right" | "both";

// A local session record. `finishedAt` is stamped on finish; the row is filed
// into the sessions list whether or not it has synced yet.
export interface LocalSession {
  id: string; // client-generated session id
  date: string; // ISO date the session belongs to
  origin: string; // short description: program day name, or "Ad-hoc"
  programId: number | null;
  createdAt: string; // ISO
  finishedAt: string | null; // ISO instant, stamped on "Finish session"
  // First finish — stamped once, NEVER rewritten by edits/re-finishes. The
  // sessions list displays/sorts by `date` + this, so editing an old session
  // can't move it to "today" (a real-data bug that hit the user's history).
  firstFinishedAt?: string | null;
  // 'user' when the date/time were set BY the user via the session editor —
  // traceable input (like restSource 'user'); finish stamping never overwrites
  // a user-set (or user-cleared) value. Null/undefined = system-stamped.
  firstFinishedSource?: "user" | null;
  // The session's date/time have an un-pushed user edit (same dirty-flag
  // pattern as occurrencesDirty). Cleared when the meta PATCH lands.
  metaDirty?: boolean;
  finishSynced: boolean;
  // The ordered occurrence list has an un-pushed change (add/remove/reorder).
  // Dirtiness is a property of the *list*, not of any single occurrence — so it
  // survives even when the last occurrence is removed (nothing left to flag),
  // which the old per-occurrence approach couldn't. Cleared when the list POSTs.
  occurrencesDirty?: boolean;
  // Set when the server refused to prune occurrence(s) we tried to drop because
  // they still carry logged sets/cardio (server `keptWithHistory`) AND deleting
  // our local sets didn't resolve it — i.e. THIS DEVICE is the stale side (the
  // server has data we never knew about). Re-POSTing local can't fix it (dead
  // end); the correct heal is to pull the server's copy down (rehydrate).
  occurrenceConflict?: boolean;
}

export interface SessionSet {
  localId?: number;
  sessionId: string;
  instanceId: string; // the performed occurrence this set belongs to (v2)
  date: string; // the session's date (denormalized for the workout_log)
  exerciseId: string;
  exerciseName: string;
  equipmentId: string | null;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  effort: EffortTag | null;
  rir: number | null;
  serverId: number | null;
  syncState: SetSyncState;
  // Logging depth (all optional — legacy rows simply lack them):
  loggedAt?: string; // ISO instant the set was logged (client-stamped)
  restSeconds?: number | null; // null/undefined = unknown, never fabricated
  restSource?: RestSource | null;
  dropGroupId?: string | null; // parent + drops share one group id
  side?: SetSide | null; // unilateral exercises only
  loadEntered?: number | null; // what the user set/added (load = entered + offset)
  builtinOffset?: number | null; // machine built-in / bar weight applied
  // Display label of the referenced unit (surrogate-key model) — carried so an
  // offline-created unit auto-registers server-side with its real label.
  equipmentLabel?: string | null;
  // The always-answered equipment TYPE (Part 3): bodyweight | dumbbell | … |
  // smith | plate_loaded. Null = legacy row. Lanes derive from (type, unitId).
  equipmentType?: string | null;
  // Offset of an offline-created unit, so auto-registration lands it complete.
  equipmentBuiltInWeight?: number | null;
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
  unilateral?: boolean; // side selector shows only for unilateral exercises
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

// Versioned IndexedDB migrations for the session store.
//
// **ADDITIVE BY DEFAULT — this is the template to copy.** Each version's block
// only *creates* what's new (createObjectStore / createIndex) and must NEVER drop
// or recreate a store that carries data forward. A destructive bump silently
// loses unsynced, in-progress local work (sets/cardio/occurrences not yet on the
// server) — the exact data the user is mid-session with. To add a version: bump
// the number in `openDB()` below and append `if (oldVersion < N) { … }` with
// creates only. Verify the guard *before* shipping the bump it protects.
//
// The one destructive step (`oldVersion < 4`) is a documented historical
// exception, not the pattern — see its comment.
export function migrateSessionDb(db: IDBPDatabase<SessionDB>, oldVersion: number): void {
  const names = db.objectStoreNames as unknown as DOMStringList;

  if (oldVersion < 4) {
    // HISTORICAL ONE-OFF (session-model v2). Pre-v4 stores (date-keyed
    // `sets`/`cardio`, `composition`, `meta`) have no occurrence link and can't be
    // transformed into the occurrence model, so any *unsynced* pre-v2 local data
    // is dropped here; finished sessions are safe on the server and re-hydrate via
    // GET /api/sessions. Runs only for devices below v4 (fresh installs included),
    // never for v4+. DO NOT copy this drop-and-recreate shape for new versions.
    for (const name of ["sets", "completed", "meta", "composition", "occurrences", "cardio"]) {
      if (names.contains(name)) db.deleteObjectStore(name as never);
    }
    if (!names.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
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
  }

  // Future versions go here, ADDITIVE only, e.g.:
  //   if (oldVersion < 5) {
  //     const s = db.createObjectStore("newThing", { keyPath: "id" });
  //     s.createIndex("by-session", "sessionId");
  //     // NEVER deleteObjectStore on a store holding data that must survive.
  //   }
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SessionDB>("fitness-app-session", 4, {
      upgrade(db, oldVersion) {
        migrateSessionDb(db, oldVersion);
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
    occurrencesDirty: false,
  };
  await db.put("sessions", session);
  return session;
}

// Flag a session's ordered occurrence list as having an un-pushed change, so the
// next sync re-POSTs it (and the server reconciles adds/removes/reorders). Kept
// separate from per-occurrence `synced` so removing the *last* occurrence still
// records a pending list change with nothing left to flag.
async function markOccurrencesDirty(sessionId: string): Promise<void> {
  const db = await getDb();
  const s = await db.get("sessions", sessionId);
  if (s && !s.occurrencesDirty) await db.put("sessions", { ...s, occurrencesDirty: true });
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

/** Stamp finished. Re-callable — re-stamps `finishedAt`, never locks; the
 * stable `firstFinishedAt` is stamped exactly once. */
export async function finishSession(id: string): Promise<LocalSession | null> {
  const db = await getDb();
  const s = await db.get("sessions", id);
  if (!s) return null;
  const now = new Date().toISOString();
  // Stamp the stable first-finish once — but a user-provided (or user-cleared)
  // value is the user's input and is never overwritten by re-finishing.
  const first = s.firstFinishedSource === "user" ? (s.firstFinishedAt ?? null) : (s.firstFinishedAt ?? now);
  const updated: LocalSession = { ...s, finishedAt: now, firstFinishedAt: first, finishSynced: false };
  await db.put("sessions", updated);
  return updated;
}

// Reconcile the local finish flag against the server's truth. If the server
// reports a session as finished, the finish IS on the server, so a local
// `finishSynced: false` is stale (the finish POST landed but its success wasn't
// recorded — e.g. the response was lost) — flip it deterministically instead of
// waiting for the next drain to re-POST. Prevents a server-confirmed-finished
// session from showing a false "not synced". Returns how many it corrected.
export async function reconcileFinishedFromServer(finishedIds: string[]): Promise<number> {
  const db = await getDb();
  let fixed = 0;
  for (const id of finishedIds) {
    const s = await db.get("sessions", id);
    if (s && s.finishedAt && !s.finishSynced) {
      await db.put("sessions", { ...s, finishSynced: true });
      fixed += 1;
    }
  }
  return fixed;
}

// Explicit, user-initiated heal for a session whose server occurrence list
// disagrees with the local one (a session that went stale before occurrencesDirty
// existed — the flag never re-POSTs on its own). Treats the LOCAL list as the
// source of truth and re-POSTs it. Safe by construction: the server prune refuses
// to delete any occurrence that still carries logged sets/cardio, so this can
// never auto-delete real history — at worst it leaves a with-history row for
// review. Not automatic (see DECISIONS item 4 — wrong-side-wins risk).
export async function reconcileOccurrenceList(sessionId: string): Promise<SyncResult> {
  await markOccurrencesDirty(sessionId);
  return sync();
}

// The opposite heal, for when THIS device is the stale side (occurrenceConflict):
// the server holds logged sets local never knew about, so re-POSTing local is a
// dead end. Discard the local copy and rebuild it from the server's authoritative
// session — pulling the missing occurrences (and their sets/cardio) back down.
// Local-only wipe (never a server delete); the server's data is the source here.
export async function rehydrateLocalFromServer(server: ServerSession): Promise<LocalSession> {
  await deleteLocalSession(server.id);
  return hydrateFromServer(server); // local now absent → rebuilds clean (dirty/conflict false)
}

// Edit a session's date and/or first-finish time — USER-PROVIDED, source
// 'user' (traceable, like a corrected rest). Null time = honest blank. The
// change is a pending sync (metaDirty) drained via PATCH /api/sessions/[id];
// while the session hasn't synced yet the PATCH 404s harmlessly and retries
// after the log row exists. Never touches finishedAt/finishSynced.
export async function editSessionMeta(
  id: string,
  patch: { date?: string; firstFinishedAt?: string | null }
): Promise<LocalSession | null> {
  const db = await getDb();
  const s = await db.get("sessions", id);
  if (!s) return null;
  const updated: LocalSession = {
    ...s,
    ...(patch.date !== undefined ? { date: patch.date } : {}),
    ...(patch.firstFinishedAt !== undefined ? { firstFinishedAt: patch.firstFinishedAt } : {}),
    firstFinishedSource: "user",
    metaDirty: true,
  };
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
  firstFinishedAt?: string | null;
  firstFinishedSource?: "user" | null;
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
    unilateral?: boolean;
    params: Record<string, unknown> | null;
    orderIndex: number;
    source: string | null;
  }>;
  sets: Array<{
    id: number;
    sessionExerciseId: number | null;
    exerciseId: string;
    equipmentId: string | null;
    equipmentType?: string | null;
    setIndex: number;
    setType: "warmup" | "working";
    load: string;
    reps: number;
    effort: EffortTag | null;
    rir: string | null;
    loggedAt?: string | null;
    restSeconds?: number | null;
    restSource?: RestSource | null;
    dropSetGroup?: string | null;
    side?: SetSide | null;
    loadEntered?: string | null;
    builtinOffset?: string | null;
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
    firstFinishedAt: server.firstFinishedAt ?? server.finishedAt,
    firstFinishedSource: server.firstFinishedSource ?? null,
    metaDirty: false,
    finishSynced: true,
    occurrencesDirty: false, // hydrated straight from the server = already in sync
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
      unilateral: e.unilateral ?? false,
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
      equipmentId: s.equipmentId,
      equipmentType: s.equipmentType ?? null,
      setIndex: s.setIndex,
      setType: s.setType,
      load: Number(s.load),
      reps: s.reps,
      effort: s.effort,
      rir: s.rir != null ? Number(s.rir) : null,
      loggedAt: s.loggedAt ?? undefined,
      restSeconds: s.restSeconds ?? null,
      restSource: s.restSource ?? null,
      dropGroupId: s.dropSetGroup ?? null,
      side: s.side ?? null,
      loadEntered: s.loadEntered != null ? Number(s.loadEntered) : null,
      builtinOffset: s.builtinOffset != null ? Number(s.builtinOffset) : null,
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
  equipmentId: string | null;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  effort: EffortTag | null;
  rir: number | null;
  // Logging depth (all optional):
  timedRestSeconds?: number | null; // from the rest timer → source "timed"
  dropGroupId?: string | null; // set for drop segments (and assigned to parents)
  parentSetIndex?: number | null; // drops share the parent's set number
  side?: SetSide | null;
  loadEntered?: number | null;
  builtinOffset?: number | null;
  equipmentLabel?: string | null;
  equipmentType?: string | null;
  equipmentBuiltInWeight?: number | null;
}

// Estimated seconds a set takes: ~3.5s per rep. Only used to back the rest
// estimate out of the log-to-log gap; never shown as a fact.
const SECONDS_PER_REP = 3.5;

/** Derive rest-before-this-set from the gap since the previous logged set.
 * Plausibility filter — an honest unknown (null) beats a fabricated number:
 *   gap < 30s  → batch/retroactive logging → unknown
 *   gap > 8min → walked away / logged later → unknown
 *   else       → rest ≈ gap − reps × 3.5s (clamped ≥ 0), source "derived". */
export function deriveRest(gapSeconds: number, reps: number): { restSeconds: number; restSource: RestSource } | null {
  if (!Number.isFinite(gapSeconds) || gapSeconds < 30 || gapSeconds > 8 * 60) return null;
  return { restSeconds: Math.max(0, Math.round(gapSeconds - reps * SECONDS_PER_REP)), restSource: "derived" };
}

export async function logSet(input: LogSetInput): Promise<SessionSet> {
  const db = await getDb();
  // Set index is per-occurrence, so two occurrences of the same exercise each
  // number their sets from 1. Drop segments share the parent's number instead.
  const existing = await db.getAllFromIndex("sets", "by-instance", input.instanceId);
  const live = existing.filter((s) => s.syncState !== "pending_delete");
  // One past the highest existing index — NOT live.length+1, which collides when
  // a middle set was deleted (delete set 3 of 4 → count 3 → next 4 duplicates the
  // old 4). max+1 leaves a harmless gap instead of a duplicate set number.
  const setIndex = input.parentSetIndex ?? live.reduce((m, s) => Math.max(m, s.setIndex), 0) + 1;

  const loggedAt = new Date().toISOString();
  // Rest is an EDGE between sets of the same occurrence, stored as restBefore
  // on the later set: N sets = N−1 rests, null on set 1. The gap across an
  // exercise boundary is an inter-exercise transition — excluded entirely, never
  // derived from (rest between exercises may become its own thing later).
  // Sources: timer (exact) > derived (gap heuristic) > unknown (null).
  let restSeconds: number | null = null;
  let restSource: RestSource | null = null;
  const hasPriorInOccurrence = live.length > 0;
  if (hasPriorInOccurrence && input.timedRestSeconds != null && input.timedRestSeconds >= 0) {
    restSeconds = Math.round(input.timedRestSeconds);
    restSource = "timed";
  } else if (hasPriorInOccurrence) {
    let prevMs = 0;
    for (const s of live) {
      if (!s.loggedAt) continue;
      const t = Date.parse(s.loggedAt);
      if (t > prevMs) prevMs = t;
    }
    if (prevMs > 0) {
      const derived = deriveRest((Date.parse(loggedAt) - prevMs) / 1000, input.reps);
      if (derived) ({ restSeconds, restSource } = derived);
    }
  }

  const { timedRestSeconds: _t, parentSetIndex: _p, ...rest } = input;
  void _t; void _p;
  const row: SessionSet = {
    ...rest,
    setIndex,
    loggedAt,
    restSeconds,
    restSource,
    dropGroupId: input.dropGroupId ?? null,
    side: input.side ?? null,
    loadEntered: input.loadEntered ?? null,
    builtinOffset: input.builtinOffset ?? null,
    equipmentLabel: input.equipmentLabel ?? null,
    equipmentType: input.equipmentType ?? null,
    equipmentBuiltInWeight: input.equipmentBuiltInWeight ?? null,
    serverId: null,
    syncState: "pending_create",
  };
  const localId = await db.add("sets", row);
  return { ...row, localId };
}

export async function getSessionSets(sessionId: string): Promise<SessionSet[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("sets", "by-session", sessionId);
  return rows.filter((s) => s.syncState !== "pending_delete").sort((a, b) => (a.localId ?? 0) - (b.localId ?? 0));
}

// Self-heal orphaned singleton drop groups (a drop set needs ≥2 members). The
// old "+ Drop" flow tagged the parent on tap, so tapping without committing a
// segment left the parent alone in a group — invisible in the UI but a stray
// tag that the set PATCH would re-push. With the fixed flow a persisted
// singleton can only be legacy data, so nulling it on load is always safe; the
// cleared tag syncs (idempotently) to the server. Returns how many it healed.
export async function healSingletonDropGroups(sessionId: string): Promise<number> {
  const db = await getDb();
  const rows = (await db.getAllFromIndex("sets", "by-session", sessionId)).filter((s) => s.syncState !== "pending_delete");
  const count = new Map<string, number>();
  for (const s of rows) if (s.dropGroupId) count.set(s.dropGroupId, (count.get(s.dropGroupId) ?? 0) + 1);
  let healed = 0;
  for (const s of rows) {
    if (s.dropGroupId && count.get(s.dropGroupId) === 1 && s.localId != null) {
      await editSet(s.localId, { dropGroupId: null });
      healed += 1;
    }
  }
  return healed;
}

export async function editSet(
  localId: number,
  patch: {
    load?: number; reps?: number; rir?: number | null; effort?: EffortTag | null; setType?: "warmup" | "working";
    restSeconds?: number | null; restSource?: RestSource | null; dropGroupId?: string | null;
    side?: SetSide | null; loadEntered?: number | null; builtinOffset?: number | null;
    equipmentId?: string | null; equipmentLabel?: string | null; equipmentType?: string | null;
  }
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
  unilateral?: boolean;
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
    unilateral: item.unilateral ?? false,
    targetSets: item.targetSets ?? null,
    repRange: item.repRange ?? null,
    rirTarget: item.rirTarget ?? null,
    params: item.params ?? null,
    synced: false,
  };
  await db.put("occurrences", occ);
  await markOccurrencesDirty(sessionId);
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
  await markOccurrencesDirty(sessionId);
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
  // Removing an occurrence shortens the ordered list, which must be re-POSTed so
  // the server prunes the dropped instance (else it lingers, inflating the count
  // and showing a permanent false "not synced" — the third sync-adjacent bug).
  // Dirtiness lives on the session, not on a surviving occurrence, so this holds
  // even when the *last* occurrence is removed (nothing left to flag).
  await markOccurrencesDirty(sessionId);
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
  const hasUnsyncedOcc = new Set(occRows.filter((o) => !o.synced).map((o) => o.sessionId));

  const sessions = sessionId ? [await db.get("sessions", sessionId)] : await db.getAll("sessions");
  for (const s of sessions) {
    if (!s) continue;
    if (s.finishedAt && !s.finishSynced) n += 1;
    // A dirty ordered list with no unsynced occurrence to already account for it
    // (a removal — incl. removing the last one) is still one pending change.
    if (s.occurrencesDirty && !hasUnsyncedOcc.has(s.id)) n += 1;
    // An un-pushed date/time edit is a pending change too.
    if (s.metaDirty) n += 1;
  }

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
  // One upsert per session pushes its whole ordered list (idempotent). We iterate
  // *sessions* (not just those with occurrences) so a session whose last
  // occurrence was removed still POSTs its now-empty list and the server prunes
  // the stale rows. A session syncs when its list is dirty (add/remove/reorder)
  // or any occurrence is still unsynced.
  // Push one session's ordered list. Marks its occurrences synced; returns
  // `clean` = the server fully reconciled. `clean` is false when the server kept
  // occurrence(s) we tried to drop because they still carry logged sets/cardio
  // (the wrong-side-wins guard) — we keep the session dirty and retry after the
  // set/cardio delete loops have run, at which point the row is empty and prunes.
  const pushOccurrences = async (s: LocalSession, occs: Occurrence[]): Promise<boolean> => {
    const res = await send("/api/session-exercises", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        clientSessionId: s.id,
        date: s.date,
        programDay: s.origin,
        exercises: [...occs]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((o) => ({ clientInstanceId: o.instanceId, exerciseId: o.exerciseId, orderIndex: o.orderIndex, source: o.source })),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { keptWithHistory?: string[] };
    for (const o of occs) await db.put("occurrences", { ...o, synced: true });
    return !(Array.isArray(body.keptWithHistory) && body.keptWithHistory.length > 0);
  };

  const allSessions = await db.getAll("sessions");
  const occBySession = new Map<string, Occurrence[]>();
  for (const o of await db.getAll("occurrences")) {
    (occBySession.get(o.sessionId) ?? occBySession.set(o.sessionId, []).get(o.sessionId)!).push(o);
  }
  for (const s of allSessions) {
    const occs = occBySession.get(s.id) ?? [];
    const needsSync = s.occurrencesDirty || occs.some((o) => !o.synced);
    if (!needsSync) continue;
    try {
      const clean = await pushOccurrences(s, occs);
      // Clean → fully reconciled. Not clean → keep dirty for the post-delete
      // retry (pass 2); don't declare a conflict yet (the sets may still delete).
      await db.put("sessions", { ...s, occurrencesDirty: !clean, occurrenceConflict: false });
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
            equipmentId: row.equipmentId,
            equipmentLabel: row.equipmentLabel ?? null,
            equipmentType: row.equipmentType ?? null,
            equipmentBuiltInWeight: row.equipmentBuiltInWeight ?? null,
            setIndex: row.setIndex,
            setType: row.setType,
            load: row.load,
            reps: row.reps,
            effort: row.effort,
            rir: row.rir,
            loggedAt: row.loggedAt ?? null,
            restSeconds: row.restSeconds ?? null,
            restSource: row.restSource ?? null,
            dropSetGroup: row.dropGroupId ?? null,
            side: row.side ?? null,
            loadEntered: row.loadEntered ?? null,
            builtinOffset: row.builtinOffset ?? null,
          }),
        });
        const created = await res.json();
        await db.put("sets", { ...row, serverId: created.id, syncState: "synced" });
        result.created += 1;
      } else if (row.syncState === "pending_update" && row.serverId != null) {
        await send(`/api/set-logs/${row.serverId}`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({
            load: row.load, reps: row.reps, effort: row.effort, rir: row.rir, setType: row.setType,
            restSeconds: row.restSeconds ?? null, restSource: row.restSource ?? null,
            dropSetGroup: row.dropGroupId ?? null, side: row.side ?? null,
            equipmentId: row.equipmentId ?? null, equipmentType: row.equipmentType ?? null,
            loadEntered: row.loadEntered ?? null, builtinOffset: row.builtinOffset ?? null,
          }),
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

  // Second occurrence pass: a session still dirty after the first pass had an
  // occurrence the server kept because it still had logged sets/cardio. Those
  // sets/cardio were just deleted above, so the row is now empty — re-POST so it
  // prunes and the flag clears (heals a legit remove-with-sets in one sync).
  for (const s of await db.getAll("sessions")) {
    if (!s.occurrencesDirty) continue;
    const occs = await db.getAllFromIndex("occurrences", "by-session", s.id);
    try {
      const clean = await pushOccurrences(s, occs);
      // Still not clean after our deletes ran = THIS DEVICE is the stale side (the
      // server has logged sets we never knew about). Flag a conflict so the UI
      // offers the correct heal (pull from server), not another no-op Reconcile.
      await db.put("sessions", { ...s, occurrencesDirty: !clean, occurrenceConflict: !clean });
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
          firstFinishedAt: s.firstFinishedAt ?? s.finishedAt,
        }),
      });
      await db.put("sessions", { ...s, finishSynced: true });
      result.finished += 1;
    } catch (e) {
      if (record(e)) return result;
    }
  }

  // Drain un-pushed date/time edits. A 404 means the log row doesn't exist
  // server-side yet — keep the edit pending (not a failure) and retry on the
  // next drain, after the creation paths above have made the row.
  for (const s of await db.getAll("sessions")) {
    if (!s.metaDirty) continue;
    try {
      const res = await send(`/api/sessions/${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ date: s.date, firstFinishedAt: s.firstFinishedAt ?? null }),
      }, true);
      if (res.status !== 404) {
        await db.put("sessions", { ...s, metaDirty: false });
        result.updated += 1;
      }
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
