import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { openDB } from "idb";
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
  reconcileFinishedFromServer,
  reconcileOccurrenceList,
  rehydrateLocalFromServer,
  migrateSessionDb,
  deriveRest,
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

// Data-loss guard (item A): the IndexedDB `upgrade` must be additive — a future
// version bump must NOT drop stores holding unsynced in-progress work. Verified
// here in isolation, separate from any real bump, so the guard is proven before
// it's relied on. `migrateSessionDb` is the single source of truth for both.
describe("IndexedDB migrations are additive (data-loss guard)", () => {
  const NAME = "migration-guard-test-db";
  const openAt = (version: number) =>
    openDB(NAME, version, { upgrade(d, oldVersion) { migrateSessionDb(d as never, oldVersion); } });
  const storeNames = (db: { objectStoreNames: DOMStringList }) => [...db.objectStoreNames].sort();

  afterEach(async () => { await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = r.onerror = () => res(); }); });

  it("a fresh open creates the full session-model-v2 store set", async () => {
    const db = await openAt(4);
    expect(storeNames(db)).toEqual(["cardio", "completed", "occurrences", "sessions", "sets"]);
    db.close();
  });

  it("a future version bump (v4 → v5) preserves existing stores AND their data", async () => {
    const db4 = await openAt(4);
    // In-progress, unsynced local work — exactly what a destructive bump would eat.
    // Includes the logging-depth record fields (rest/drop/side/load components):
    // these are schemaless per-record additions, so they must round-trip through a
    // bump untouched (and NOT require one themselves).
    await db4.put("sessions", { id: "keep-me", date: "2026-01-01", origin: "Leg day", programId: null, createdAt: "t0", finishedAt: null, finishSynced: false });
    await db4.add("sets", {
      sessionId: "keep-me", instanceId: "inst-1", serverId: null, syncState: "pending_create",
      setIndex: 1, load: 110, reps: 5,
      loggedAt: "2026-01-01T10:00:00.000Z", restSeconds: 115, restSource: "derived",
      dropGroupId: "grp-1", side: "left", loadEntered: 90, builtinOffset: 20,
    } as never);
    db4.close();

    // Bump the version: migrateSessionDb(db, oldVersion=4) has no v5 block, so it's
    // a no-op — the whole point is that this DOESN'T wipe anything.
    const db5 = await openAt(5);
    expect(storeNames(db5)).toEqual(["cardio", "completed", "occurrences", "sessions", "sets"]);
    expect(await db5.get("sessions", "keep-me")).toBeTruthy(); // survived the bump
    const sets = (await db5.getAll("sets")) as Array<Record<string, unknown>>;
    expect(sets.length).toBe(1); // unsynced set survived too
    // Every new logging-depth field round-trips intact.
    expect(sets[0]).toMatchObject({
      load: 110, loggedAt: "2026-01-01T10:00:00.000Z", restSeconds: 115, restSource: "derived",
      dropGroupId: "grp-1", side: "left", loadEntered: 90, builtinOffset: 20,
    });
    db5.close();
  });
});

// Rest tracking (logging depth, Part 1). Honest-unknown model: derivation only
// inside the plausibility band, everything else stays null — never fabricated.
describe("rest tracking — derivation, timer, honesty tags", () => {
  it("deriveRest applies the plausibility band and backs out set duration", () => {
    expect(deriveRest(10, 8)).toBeNull(); // batch logging → unknown
    expect(deriveRest(29, 8)).toBeNull(); // below band
    expect(deriveRest(9 * 60, 8)).toBeNull(); // walked away → unknown
    expect(deriveRest(120, 8)).toEqual({ restSeconds: 120 - 28, restSource: "derived" }); // 8 reps × 3.5s
    expect(deriveRest(31, 20)).toEqual({ restSeconds: 0, restSource: "derived" }); // clamped ≥ 0
  });

  it("first set = unknown; a later set derives from the gap; timer wins as 'timed'; edit becomes 'user'", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-20T10:00:00Z") });
    try {
      mockOnline();
      const { id, date, inst } = await newSession();

      const first = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
      expect(first.restSeconds).toBeNull(); // nothing before it → unknown
      expect(first.restSource).toBeNull();

      vi.setSystemTime(new Date("2026-08-20T10:02:00Z")); // 120s later
      const second = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date });
      expect(second.restSeconds).toBe(120 - Math.round(8 * 3.5)); // gap − reps×3.5s
      expect(second.restSource).toBe("derived");

      // Timer overrides derivation with an exact value.
      const third = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, timedRestSeconds: 95 });
      expect(third.restSeconds).toBe(95);
      expect(third.restSource).toBe("timed");

      // A manual correction becomes the highest-trust source. (Still unsynced
      // here, so it stays pending_create — the correction rides the create POST.)
      await editSet(second.localId!, { restSeconds: 100, restSource: "user" });
      const after = (await getSessionSets(id)).find((s) => s.localId === second.localId)!;
      expect(after.restSeconds).toBe(100);
      expect(after.restSource).toBe("user");
      expect(after.syncState).toBe("pending_create");

      // Once synced, a rest correction re-syncs as an update.
      await sync();
      await editSet(second.localId!, { restSeconds: 105, restSource: "user" });
      const resynced = (await getSessionSets(id)).find((s) => s.localId === second.localId)!;
      expect(resynced.syncState).toBe("pending_update");
    } finally {
      vi.useRealTimers();
    }
  });
});

// Drop sets (Part 2): parent + drops share a group id and the parent's set
// number; drops are their own rows (volume math needs no change).
describe("drop sets — linked rows, shared group + set number", () => {
  it("a drop shares the parent's setIndex and group id, and syncs both", async () => {
    mockOnline();
    const { id, date, inst } = await newSession();
    const parent = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 100 });
    expect(parent.setIndex).toBe(1);

    // "+ Drop": assign the group to the parent, then log the drop segment.
    await editSet(parent.localId!, { dropGroupId: "grp-1" });
    const drop = await logSet({
      ...baseInput, sessionId: id, instanceId: inst, date, load: 70,
      dropGroupId: "grp-1", parentSetIndex: parent.setIndex,
    });
    expect(drop.setIndex).toBe(1); // shares the parent's number, not 2
    expect(drop.dropGroupId).toBe("grp-1");

    // A normal set after the drop still numbers from the live count.
    const next = await logSet({ ...baseInput, sessionId: id, instanceId: inst, date, load: 100 });
    expect(next.setIndex).toBe(3); // three live rows exist

    const r = await sync();
    expect(r.created).toBe(3);
    const rows = await getSessionSets(id);
    expect(rows.filter((s) => s.dropGroupId === "grp-1")).toHaveLength(2);
    expect(rows.every((s) => s.syncState === "synced")).toBe(true);
  });
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

// Third sync-adjacent data-integrity bug: removing an already-synced occurrence
// must re-POST the shortened list so the server prunes the dropped instance.
// Before the fix, the occurrence sync loop skipped any session whose remaining
// occurrences were all `synced`, so the removal never reached the server: the
// dropped occurrence lingered, inflating the server's exercise count and making
// the sessions list show a permanent, false "not synced" while sync reported OK.
describe("removing a synced occurrence re-syncs the shortened list (bug 1)", () => {
  const tri: AttachExercise = { exerciseId: "skull_crusher", exerciseName: "Skullcrusher", loadType: "free_weight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false };

  // Capture the occurrence lists the client POSTs, so we can assert the server
  // is told about the removal (the real server would then prune it).
  function mockOnlineCapturingOccurrences(sink: string[][]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (url === "/api/session-exercises" && method === "POST") {
          const body = JSON.parse(String(opts?.body ?? "{}")) as { exercises: Array<{ clientInstanceId: string }> };
          sink.push(body.exercises.map((e) => e.clientInstanceId));
          return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
        }
        if (url === "/api/set-logs" && method === "POST") return { ok: true, status: 201, json: async () => ({ id: nextServerId++ }) } as Response;
        if (/\/api\/set-logs\/\d+$/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );
  }

  it("re-POSTs the pruned occurrence list after a synced occurrence is removed", async () => {
    const posts: string[][] = [];
    mockOnlineCapturingOccurrences(posts);

    const { id } = await newSession(); // one occurrence (deadlift)
    const extra = await addOccurrence(id, tri, "Chest + triceps");
    await sync(); // both occurrences land server-side, marked synced locally
    expect(await pendingCount(id)).toBe(0);
    posts.length = 0; // ignore the initial pushes; focus on what happens after removal

    // Remove the second occurrence, then sync again.
    await removeOccurrence(id, extra.instanceId);
    // The removal is a pending change until it reaches the server.
    expect(await pendingCount(id)).toBeGreaterThan(0);
    const result = await sync();
    expect(result.authError).toBe(false);

    // The client must have re-POSTed the shortened list (deadlift only) so the
    // server can prune the removed instance — before the fix, no POST happened.
    expect(posts.length).toBeGreaterThan(0);
    const last = posts[posts.length - 1];
    expect(last).not.toContain(extra.instanceId);
    expect(last).toHaveLength(1);

    // And the session is fully synced again (no lingering false "not synced").
    expect(await pendingCount(id)).toBe(0);
  });

  it("keeps re-syncing across several removals in a row (down to one survivor)", async () => {
    const posts: string[][] = [];
    mockOnlineCapturingOccurrences(posts);

    const { id } = await newSession(); // deadlift
    const a = await addOccurrence(id, tri, "Chest + triceps");
    const b = await addOccurrence(id, tri, "Chest + triceps");
    await sync();
    expect(await pendingCount(id)).toBe(0);

    // Remove two, one after another, each with its own sync.
    await removeOccurrence(id, a.instanceId);
    await sync();
    await removeOccurrence(id, b.instanceId);
    await sync();

    // The last list the server saw has just the surviving deadlift occurrence.
    const last = posts[posts.length - 1];
    expect(last).not.toContain(a.instanceId);
    expect(last).not.toContain(b.instanceId);
    expect(last).toHaveLength(1);
    expect(await pendingCount(id)).toBe(0);
  });

  // Item 3, now fixed by the session-level `occurrencesDirty` flag: removing the
  // *last/only* occurrence leaves no survivor to dirty, but dirtiness lives on the
  // session, so the sync loop still re-POSTs the now-empty list and the server
  // prunes the stale row.
  it("re-POSTs an empty list when the last occurrence is removed", async () => {
    const posts: string[][] = [];
    mockOnlineCapturingOccurrences(posts);

    const { id } = await newSession(); // exactly one occurrence
    await sync();
    const only = (await listOccurrences(id))[0];
    posts.length = 0;

    await removeOccurrence(id, only.instanceId); // now zero occurrences
    expect(await pendingCount(id)).toBeGreaterThan(0); // the list change is pending
    await sync();

    // The server must be told the list is now empty so it prunes the last row.
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[posts.length - 1]).toHaveLength(0);
    expect(await pendingCount(id)).toBe(0);
  });
});

describe("reconcile finish flag from server truth (false 'not synced' fix)", () => {
  it("flips a stale local finishSynced=false when the server reports finished", async () => {
    const { id } = await newSession();
    mockOffline();
    await finishSession(id); // finishedAt set, finishSynced=false (finish POST never landed here)
    expect((await getSession(id))?.finishSynced).toBe(false);

    // Simulate the real case: the finish actually IS on the server (its response
    // was just lost). The sessions page reconciles from the server's finished list.
    const fixed = await reconcileFinishedFromServer([id]);
    expect(fixed).toBe(1);
    expect((await getSession(id))?.finishSynced).toBe(true);

    // A session with no local finishedAt is untouched (nothing to reconcile).
    expect(await reconcileFinishedFromServer(["nonexistent"])).toBe(0);
  });
});

// The wrong-side-wins guard + its paired client retry (item 4, "safe reconcile").
// A stateful mock server mirrors the real /api/session-exercises prune: it refuses
// to drop an occurrence that still has logged sets, reporting it in keptWithHistory
// until those sets are deleted.
describe("history-safe prune + two-pass heal (occurrence with synced sets)", () => {
  const tri: AttachExercise = { exerciseId: "skull_crusher", exerciseName: "Skullcrusher", loadType: "free_weight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false };

  function statefulServer() {
    const occ = new Set<string>(); // instanceIds the server currently holds
    const setToInst = new Map<number, string>(); // set serverId -> instanceId
    const instHasSets = () => new Set([...setToInst.values()]);
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (url === "/api/session-exercises" && method === "POST") {
        const list = (JSON.parse(String(opts?.body ?? "{}")).exercises as Array<{ clientInstanceId: string }>).map((e) => e.clientInstanceId);
        const keep = new Set(list);
        const withSets = instHasSets();
        const keptWithHistory: string[] = [];
        for (const id of [...occ]) {
          if (keep.has(id)) continue;
          if (withSets.has(id)) keptWithHistory.push(id); // guard: never drop a row with sets
          else occ.delete(id);
        }
        for (const id of list) occ.add(id);
        return { ok: true, status: 200, json: async () => ({ ok: true, keptWithHistory }) } as Response;
      }
      if (url === "/api/set-logs" && method === "POST") {
        const inst = JSON.parse(String(opts?.body ?? "{}")).instanceId as string;
        const id = nextServerId++;
        setToInst.set(id, inst);
        return { ok: true, status: 201, json: async () => ({ id }) } as Response;
      }
      const del = url.match(/\/api\/set-logs\/(\d+)$/);
      if (del && method === "DELETE") {
        setToInst.delete(Number(del[1]));
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    return { serverOcc: occ };
  }

  it("keeps the occurrence until its sets delete, then prunes it — no phantom, no lost sets", async () => {
    const { serverOcc } = statefulServer();
    const { id, date } = await newSession(); // deadlift occurrence
    const only = (await listOccurrences(id))[0];
    const t = await addOccurrence(id, tri, "Chest + triceps");
    await logSet({ ...baseInput, sessionId: id, instanceId: t.instanceId, date, load: 90 });
    await sync();
    expect([...serverOcc].sort()).toEqual([only.instanceId, t.instanceId].sort());
    expect(await pendingCount(id)).toBe(0);

    // Remove the occurrence that HAS a synced set.
    await removeOccurrence(id, t.instanceId);
    const r = await sync();
    expect(r.authError).toBe(false);

    // One sync heals it: the set was deleted, then the now-empty row pruned.
    expect([...serverOcc]).toEqual([only.instanceId]); // tri pruned, deadlift kept
    expect(await pendingCount(id)).toBe(0); // flag cleared, nothing lingering
    // The deleted set is gone locally too (no orphaned set for the removed occ).
    expect((await getSessionSets(id)).some((s) => s.instanceId === t.instanceId)).toBe(false);
  });
});

// Refusal path (item 2): the server keeps set-bearing occurrences this device
// can't delete (it never knew about them) — THIS device is the stale side, so
// Reconcile (re-POST local) is a dead end. We must flag it and offer the opposite
// heal: pull the server's copy down.
describe("refusal path — this device is behind, pull-from-server heals it", () => {
  it("flags occurrenceConflict when the server keeps sets local can't delete, then rehydrate fixes it", async () => {
    const serverOcc = new Set<string>();
    const withSets = new Set<string>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === "/api/session-exercises" && (opts?.method ?? "GET") === "POST") {
        const list = (JSON.parse(String(opts?.body ?? "{}")).exercises as Array<{ clientInstanceId: string }>).map((e) => e.clientInstanceId);
        const keep = new Set(list);
        const keptWithHistory: string[] = [];
        for (const gid of [...serverOcc]) {
          if (keep.has(gid)) continue;
          if (withSets.has(gid)) keptWithHistory.push(gid); // guard keeps it
          else serverOcc.delete(gid);
        }
        for (const gid of list) serverOcc.add(gid);
        return { ok: true, status: 200, json: async () => ({ ok: true, keptWithHistory }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));

    const { id } = await newSession();
    const a = (await listOccurrences(id))[0].instanceId;
    await sync(); // server now holds [a], clean

    // The server also holds an occurrence with a logged set this device never had.
    serverOcc.add("srv-b");
    withSets.add("srv-b");

    // Reconcile re-POSTs local [a] — the dead end: srv-b is kept (has a set) and
    // local has no delete to fire, so it can't be resolved by pushing local.
    await reconcileOccurrenceList(id);
    const stale = await getSession(id);
    expect(stale?.occurrenceConflict).toBe(true); // surfaced, not a silent forever-badge
    expect(stale?.occurrencesDirty).toBe(true);
    expect(await pendingCount(id)).toBeGreaterThan(0);

    // The opposite heal: pull the server's authoritative copy down.
    const server: ServerSession = {
      id, clientSessionId: id, date: "2026-08-01", programDay: "Test day", finishedAt: null,
      exercises: [
        { sessionExerciseId: 1, clientInstanceId: a, exerciseId: "deadlift", exerciseName: "Deadlift", loadType: "free_weight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false, params: null, orderIndex: 0, source: "Test day" },
        { sessionExerciseId: 2, clientInstanceId: "srv-b", exerciseId: "skull_crusher", exerciseName: "Skullcrusher", loadType: "free_weight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false, params: null, orderIndex: 1, source: "Test day" },
      ],
      sets: [ { id: 999, sessionExerciseId: 2, exerciseId: "skull_crusher", machineId: null, setIndex: 1, setType: "working", load: "80", reps: 8, effort: "near_failure", rir: null } ],
      cardio: [],
    };
    await rehydrateLocalFromServer(server);

    // Local now matches the server: the missing occurrence + its set are back,
    // and the conflict/pending state is cleared.
    expect((await listOccurrences(id)).map((o) => o.exerciseId)).toEqual(["deadlift", "skull_crusher"]);
    expect((await getSession(id))?.occurrenceConflict ?? false).toBe(false);
    expect((await getSessionSets(id)).length).toBe(1);
    expect(await pendingCount(id)).toBe(0);
  });
});

// The gap that let session 3 sit broken: a session that went stale *before* the
// occurrencesDirty flag existed (its list shrank locally but never re-POSTed) has
// occurrencesDirty=false and all remaining occurrences synced — so the store
// believes it's clean and plain sync() never re-sends the shortened list. This
// characterises that state; it is NOT auto-healed today (list-arm auto-reconcile
// is a proposed, not-yet-built design because of the wrong-side-wins risk).
describe("pre-existing stale session (clean dirty flag + shorter local list)", () => {
  const tri: AttachExercise = { exerciseId: "skull_crusher", exerciseName: "Skullcrusher", loadType: "free_weight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false };

  it("plain sync() does NOT re-reconcile it, and the store reports it as clean", async () => {
    const posts: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (url === "/api/session-exercises" && (opts?.method ?? "GET") === "POST") {
          posts.push((JSON.parse(String(opts?.body ?? "{}")).exercises as Array<{ clientInstanceId: string }>).map((e) => e.clientInstanceId));
          return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );

    const { id } = await newSession(); // deadlift
    const extra = await addOccurrence(id, tri, "Chest + triceps");
    await sync(); // server + local both have 2; synced; flag cleared
    expect(await pendingCount(id)).toBe(0);

    // Simulate the OLD (pre-fix) removeOccurrence: drop one occurrence from the
    // local store WITHOUT dirtying the session — the exact state session 3 was in.
    const db = await openDB("fitness-app-session", 4);
    await db.delete("occurrences", extra.instanceId);
    const s = await db.get("sessions", id);
    await db.put("sessions", { ...s, occurrencesDirty: false });
    db.close();
    expect((await listOccurrences(id)).length).toBe(1); // local now shorter than server's 2

    posts.length = 0;
    await sync();

    // The bug: nothing is re-POSTed, so the server keeps its stale extra row, and
    // the store can't tell (pendingCount 0). This is why the badge flagged forever
    // until a manual heal. A regression here (accidental auto-heal) should be a
    // deliberate, reviewed change — see the item-4 proposal in DECISIONS.
    expect(posts).toHaveLength(0);
    expect(await pendingCount(id)).toBe(0);
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
