import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createSession,
  logSet,
  editSet,
  deleteSet,
  getSessionSets,
  finishSession,
  getSession,
  hydrateFromServer,
  sync,
  pendingCount,
  logCardio,
  getSessionCardio,
  deleteCardio,
  deleteSession,
  addOccurrence,
  listOccurrences,
  moveOccurrence,
  removeOccurrence,
  listLocalSessionSummaries,
  _resetDbForTests,
  type AttachExercise,
  type ServerSession,
} from "../sessionStore";

// The session store is the load-bearing offline layer. These tests drive its
// sync state machine with fetch mocked online/offline — the behaviors that
// can't be exercised through the browser preview (which has no network toggle),
// especially "correct a set that already synced, while offline" (the user's
// explicit same-session requirement). A session is now a client-generated id,
// so each test starts one and keys everything by it.

const baseInput = {
  exerciseId: "deadlift",
  exerciseName: "Deadlift",
  machineId: null,
  setType: "working" as const,
  load: 100,
  reps: 8,
  effort: "near_failure" as const,
  rir: null,
};

// Minimal localStorage for the offline session-delete queue (node test env).
const lsStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, v),
  removeItem: (k: string) => void lsStore.delete(k),
  clear: () => lsStore.clear(),
  key: () => null,
  length: 0,
} as Storage;

let nextServerId = 1000;

function mockOnline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (url === "/api/session-exercises" && method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (url === "/api/set-logs" && method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: nextServerId++ }) } as Response;
      }
      if (/\/api\/set-logs\/\d+$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (url === "/api/cardio-logs" && method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: nextServerId++ }) } as Response;
      }
      if (/\/api\/cardio-logs\/\d+$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (url === "/api/sessions/finish") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

function mockOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    })
  );
}

// The proxy returns a real 401 for /api/* once the session cookie expires
// (rather than redirecting to an HTML login page that res.json() would choke
// on). This mock stands in for that state.
function mockAuthExpired() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "auth" }) }) as Response)
  );
}

let day = 0;
function freshDate() {
  day += 1;
  return `2026-08-${String(day).padStart(2, "0")}`;
}

const attachInput: AttachExercise = {
  exerciseId: "deadlift",
  exerciseName: "Deadlift",
  loadType: "free_weight",
  portable: true,
  conditioningOnly: false,
  provenance: "curated",
  untagged: false,
};

// A session with one performed occurrence; `inst` is where sets land.
async function newSession() {
  const date = freshDate();
  const s = await createSession({ date, origin: "Test day", programId: null });
  const occ = await addOccurrence(s.id, attachInput, "Test day");
  return { id: s.id, date, inst: occ.instanceId };
}

beforeEach(async () => {
  await _resetDbForTests();
  lsStore.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logging + sync", () => {
  beforeEach(mockOnline);

  it("logs a set as pending, then sync marks it synced with a server id", async () => {
    const { id, date, inst } = await newSession();
    const row = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
    expect(row.syncState).toBe("pending_create");

    let sets = await getSessionSets(id);
    expect(sets).toHaveLength(1);
    expect(sets[0].serverId).toBeNull();

    const result = await sync();
    expect(result.created).toBe(1);

    sets = await getSessionSets(id);
    expect(sets[0].syncState).toBe("synced");
    expect(sets[0].serverId).not.toBeNull();
  });
});

describe("offline logging", () => {
  it("keeps a set logged and visible while offline, then syncs when back online", async () => {
    const { id, date, inst } = await newSession();
    mockOffline();
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
    await sync(); // fails silently
    let sets = await getSessionSets(id);
    expect(sets).toHaveLength(1);
    expect(sets[0].syncState).toBe("pending_create"); // still queued
    expect(await pendingCount(id)).toBe(2); // the occurrence + the set

    mockOnline();
    const result = await sync();
    expect(result.created).toBe(1);
    sets = await getSessionSets(id);
    expect(sets[0].syncState).toBe("synced");
    expect(await pendingCount(id)).toBe(0);
  });
});

describe("sync auth failure — data integrity (priority bug 1a)", () => {
  it("an expired session surfaces authError, keeps data pending (never lost), and re-drains after re-login", async () => {
    const { id, date, inst } = await newSession();

    // Log while the session is valid, then the cookie expires before sync.
    mockAuthExpired();
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
    const r1 = await sync();
    expect(r1.authError).toBe(true); // classified, not a silent "failed"
    expect(r1.created).toBe(0);
    // The set is still there, still queued — the local write is never dropped.
    const afterFail = await getSessionSets(id);
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0].syncState).toBe("pending_create");
    expect(await pendingCount(id)).toBe(2); // occurrence + set, both still queued

    // Re-login restores auth; the next drain flushes the outbox.
    mockOnline();
    const r2 = await sync();
    expect(r2.authError).toBe(false);
    expect(r2.created).toBe(1);
    expect((await getSessionSets(id))[0].syncState).toBe("synced");
    expect(await pendingCount(id)).toBe(0);
  });

  it("aborts the whole drain on the first 401 (every later request would 401 too)", async () => {
    const { id, date, inst } = await newSession();
    mockOnline();
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 100 });
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 105 });
    await sync(); // both synced

    // Two fresh pending creates, then auth expires.
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 110 });
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 115 });
    mockAuthExpired();
    const r = await sync();
    expect(r.authError).toBe(true);
    expect(r.created).toBe(0);
    // Neither of the two new sets was lost.
    expect(await pendingCount(id)).toBe(2);
  });
});

describe("concurrent syncs don't double-post (data integrity)", () => {
  it("two overlapping sync() calls create the set exactly once", async () => {
    const { id, date, inst } = await newSession();
    mockOnline();
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });

    // Fire two drains at once (as two rapid onSessionChanged calls would).
    const [a, b] = await Promise.all([sync(), sync()]);
    expect(a.created + b.created).toBe(1); // not 2 — serialized, no duplicate
    expect((await getSessionSets(id)).filter((s) => s.serverId != null)).toHaveLength(1);
  });
});

describe("same-session edit after sync, offline (the key requirement)", () => {
  it("edits an already-synced set while offline and re-syncs the correction", async () => {
    const { id, date, inst } = await newSession();
    // Log + sync online first (the set gets a serverId).
    mockOnline();
    const row = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 135 });
    await sync();
    let sets = await getSessionSets(id);
    expect(sets[0].syncState).toBe("synced");
    const serverId = sets[0].serverId;

    // Now offline: fat-finger correction seconds later.
    mockOffline();
    await editSet(row.localId!, { load: 145 });
    sets = await getSessionSets(id);
    expect(sets[0].load).toBe(145); // reflected immediately, offline
    expect(sets[0].syncState).toBe("pending_update");
    expect(sets[0].serverId).toBe(serverId); // same server row, will be PATCHed
    await sync(); // fails, stays pending_update
    expect((await getSessionSets(id))[0].syncState).toBe("pending_update");

    // Back online: the correction PATCHes through.
    mockOnline();
    const result = await sync();
    expect(result.updated).toBe(1);
    expect((await getSessionSets(id))[0].syncState).toBe("synced");
  });
});

describe("delete semantics", () => {
  it("hard-removes a never-synced set without any server call", async () => {
    const { id, date, inst } = await newSession();
    mockOffline();
    const row = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
    await deleteSet(row.localId!);
    expect(await getSessionSets(id)).toHaveLength(0);
    // sync has nothing to do — no fetch should have mattered
    const result = await sync();
    expect(result.deleted).toBe(0);
  });

  it("soft-deletes a synced set, hides it immediately, and DELETEs on next sync", async () => {
    const { id, date, inst } = await newSession();
    mockOnline();
    const row = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
    await sync();

    mockOffline();
    await deleteSet(row.localId!);
    expect(await getSessionSets(id)).toHaveLength(0); // hidden right away, offline

    mockOnline();
    const result = await sync();
    expect(result.deleted).toBe(1);
    expect(await getSessionSets(id)).toHaveLength(0); // gone for good
  });
});

describe("finish session", () => {
  it("stamps finish offline and syncs it when back online; re-finishing re-stamps", async () => {
    const { id } = await newSession();
    mockOffline();
    const finished = await finishSession(id);
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished?.finishSynced).toBe(false);
    expect(await pendingCount(id)).toBe(2); // the occurrence + the unsynced finish

    mockOnline();
    const result = await sync();
    expect(result.finished).toBe(1);
    expect((await getSession(id))?.finishSynced).toBe(true);

    // Not a one-way door: finishing again re-stamps and needs re-sync.
    const before = (await getSession(id))!.finishedAt!;
    await new Promise((r) => setTimeout(r, 5));
    const again = await finishSession(id);
    expect(again?.finishSynced).toBe(false);
    expect(new Date(again!.finishedAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});

describe("cardio (separate store, synced/pending like sets)", () => {
  it("logs cardio offline, keeps it visible, and syncs when back online", async () => {
    const { id, date, inst } = await newSession();
    mockOffline();
    await logCardio({
      sessionId: id, instanceId: inst, date, exerciseId: "treadmill_incline_walk", exerciseName: "Treadmill",
      durationMin: 30, incline: 12, speed: 3, distance: null, level: null, notes: null,
    });
    let entries = await getSessionCardio(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].syncState).toBe("pending_create");
    expect(await pendingCount(id)).toBe(2); // the occurrence + the cardio entry

    mockOnline();
    const result = await sync();
    expect(result.created).toBe(1);
    entries = await getSessionCardio(id);
    expect(entries[0].syncState).toBe("synced");
    expect(entries[0].serverId).not.toBeNull();
    expect(await pendingCount(id)).toBe(0);
  });

  it("deletes a synced cardio entry via DELETE on next sync", async () => {
    const { id, date, inst } = await newSession();
    mockOnline();
    const row = await logCardio({
      sessionId: id, instanceId: inst, date, exerciseId: "stair_machine", exerciseName: "Stairs",
      durationMin: 10, incline: null, speed: null, distance: null, level: 5, notes: null,
    });
    await sync();
    mockOffline();
    await deleteCardio(row.localId!);
    expect(await getSessionCardio(id)).toHaveLength(0);
    mockOnline();
    const result = await sync();
    expect(result.deleted).toBe(1);
  });
});

describe("occurrences — ordered, repeats, reorder, aggregated name (v2)", () => {
  beforeEach(mockOnline);

  const ab: AttachExercise = { exerciseId: "machine_ab_crunch", exerciseName: "Ab crunch", loadType: "machine_selectorized", portable: false, conditioningOnly: false, provenance: "curated", untagged: false };
  const tri: AttachExercise = { exerciseId: "skull_crusher", exerciseName: "Skullcrusher", loadType: "free_weight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false };

  it("appends occurrences in order, allows repeats, reorders, and aggregates the name", async () => {
    const { id } = await newSession(); // one occurrence already (deadlift, source "Test day")
    await addOccurrence(id, tri, "Chest + triceps");
    await addOccurrence(id, ab, "Abs");
    await addOccurrence(id, tri, "Chest + triceps"); // a repeat at a later position

    let occ = await listOccurrences(id);
    expect(occ.map((o) => o.exerciseId)).toEqual(["deadlift", "skull_crusher", "machine_ab_crunch", "skull_crusher"]);
    // The two triceps occurrences are distinct instances.
    expect(occ[1].instanceId).not.toBe(occ[3].instanceId);

    // Session name reflects every contributing source in first-seen order.
    expect((await getSession(id))?.origin).toBe("Test day + Chest + triceps + Abs");

    // Reorder: move the abs occurrence up one.
    await moveOccurrence(id, occ[2].instanceId, "up");
    occ = await listOccurrences(id);
    expect(occ.map((o) => o.exerciseId)).toEqual(["deadlift", "machine_ab_crunch", "skull_crusher", "skull_crusher"]);

    // Removing an accidental occurrence drops just that instance.
    await removeOccurrence(id, occ[1].instanceId);
    occ = await listOccurrences(id);
    expect(occ.map((o) => o.exerciseId)).toEqual(["deadlift", "skull_crusher", "skull_crusher"]);
  });

  it("keeps sets attached to the right occurrence across repeats", async () => {
    const { id, date } = await newSession();
    const first = (await listOccurrences(id))[0];
    const second = await addOccurrence(id, { ...attachInput }, "Test day"); // same exercise, 2nd occurrence

    await logSet({ ...baseInput, sessionId: id, instanceId: first.instanceId, date, load: 100 });
    await logSet({ ...baseInput, sessionId: id, instanceId: second.instanceId, date, load: 200 });

    const sets = await getSessionSets(id);
    // Each occurrence numbers its own sets from 1.
    const firstSets = sets.filter((s) => s.instanceId === first.instanceId);
    const secondSets = sets.filter((s) => s.instanceId === second.instanceId);
    expect(firstSets).toHaveLength(1);
    expect(firstSets[0].setIndex).toBe(1);
    expect(secondSets).toHaveLength(1);
    expect(secondSets[0].setIndex).toBe(1);
  });
});

describe("delete a session (offline-safe, Part 3a)", () => {
  it("removes local rows immediately, queues the server delete, and drains it on reconnect", async () => {
    const { id, date, inst } = await newSession();
    mockOnline();
    await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
    await sync();
    expect(await getSession(id)).not.toBeNull();

    // Delete while offline: local rows go now, server delete is queued.
    mockOffline();
    await deleteSession(id);
    expect(await getSession(id)).toBeNull();
    expect(await getSessionSets(id)).toHaveLength(0);
    const off = await sync();
    expect(off.networkError).toBe(true);
    expect(await pendingCount(id)).toBe(1); // queued delete still pending

    // Back online: the queued delete drains.
    mockOnline();
    const on = await sync();
    expect(on.deleted).toBeGreaterThanOrEqual(1);
    expect(await pendingCount(id)).toBe(0);
  });
});

describe("hydrate a server-only session (opening a past session)", () => {
  beforeEach(mockOnline);

  it("rebuilds local rows as synced, and edits then route by server id", async () => {
    const server: ServerSession = {
      id: "srv-session-1",
      clientSessionId: "srv-session-1",
      date: "2026-09-01",
      programDay: "Legs",
      finishedAt: "2026-09-01T18:00:00.000Z",
      exercises: [
        { sessionExerciseId: 77, clientInstanceId: "inst-a", exerciseId: "back_squat", exerciseName: "Back Squat", loadType: "free_weight", portable: false, conditioningOnly: false, provenance: "curated", untagged: false, params: null, orderIndex: 0, source: "Legs" },
      ],
      sets: [
        { id: 5001, sessionExerciseId: 77, exerciseId: "back_squat", machineId: null, setIndex: 1, setType: "working", load: "225", reps: 5, effort: "near_failure", rir: null },
      ],
      cardio: [],
    };

    const s = await hydrateFromServer(server);
    expect(s.finishedAt).toBe(server.finishedAt);
    expect(s.finishSynced).toBe(true);

    const sets = await getSessionSets("srv-session-1");
    expect(sets).toHaveLength(1);
    expect(sets[0].syncState).toBe("synced");
    expect(sets[0].serverId).toBe(5001);
    expect(sets[0].instanceId).toBe("inst-a"); // linked to the occurrence

    const occ = await listOccurrences("srv-session-1");
    expect(occ).toHaveLength(1);
    expect(occ[0].exerciseName).toBe("Back Squat");
    expect(occ[0].synced).toBe(true);

    // A correction routes to PATCH by the server id, not a fresh create.
    await editSet(sets[0].localId!, { load: 235 });
    const result = await sync();
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    // Hydrating again is a no-op (never clobbers local state).
    await hydrateFromServer(server);
    expect(await getSessionSets("srv-session-1")).toHaveLength(1);

    const summaries = await listLocalSessionSummaries();
    const summary = summaries.find((x) => x.id === "srv-session-1");
    expect(summary?.exerciseCount).toBe(1);
  });
});
