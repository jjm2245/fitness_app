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
  attachToComposition,
  getSessionComposition,
  removeFromComposition,
  listLocalSessionSummaries,
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

let nextServerId = 1000;

function mockOnline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
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

let day = 0;
function freshDate() {
  day += 1;
  return `2026-08-${String(day).padStart(2, "0")}`;
}

async function newSession() {
  const date = freshDate();
  const s = await createSession({ date, origin: "Test day", programId: null });
  return { id: s.id, date };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logging + sync", () => {
  beforeEach(mockOnline);

  it("logs a set as pending, then sync marks it synced with a server id", async () => {
    const { id, date } = await newSession();
    const row = await logSet({ ...baseInput, sessionId: id, date });
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
    const { id, date } = await newSession();
    mockOffline();
    await logSet({ ...baseInput, sessionId: id, date });
    await sync(); // fails silently
    let sets = await getSessionSets(id);
    expect(sets).toHaveLength(1);
    expect(sets[0].syncState).toBe("pending_create"); // still queued
    expect(await pendingCount(id)).toBe(1);

    mockOnline();
    const result = await sync();
    expect(result.created).toBe(1);
    sets = await getSessionSets(id);
    expect(sets[0].syncState).toBe("synced");
    expect(await pendingCount(id)).toBe(0);
  });
});

describe("same-session edit after sync, offline (the key requirement)", () => {
  it("edits an already-synced set while offline and re-syncs the correction", async () => {
    const { id, date } = await newSession();
    // Log + sync online first (the set gets a serverId).
    mockOnline();
    const row = await logSet({ ...baseInput, sessionId: id, date, load: 135 });
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
    const { id, date } = await newSession();
    mockOffline();
    const row = await logSet({ ...baseInput, sessionId: id, date });
    await deleteSet(row.localId!);
    expect(await getSessionSets(id)).toHaveLength(0);
    // sync has nothing to do — no fetch should have mattered
    const result = await sync();
    expect(result.deleted).toBe(0);
  });

  it("soft-deletes a synced set, hides it immediately, and DELETEs on next sync", async () => {
    const { id, date } = await newSession();
    mockOnline();
    const row = await logSet({ ...baseInput, sessionId: id, date });
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
    expect(await pendingCount(id)).toBe(1); // unsynced finish counts as pending

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
    const { id, date } = await newSession();
    mockOffline();
    await logCardio({
      sessionId: id, date, exerciseId: "treadmill_incline_walk", exerciseName: "Treadmill",
      durationMin: 30, incline: 12, speed: 3, distance: null, level: null, notes: null,
    });
    let entries = await getSessionCardio(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].syncState).toBe("pending_create");
    expect(await pendingCount(id)).toBe(1); // cardio counts toward pending

    mockOnline();
    const result = await sync();
    expect(result.created).toBe(1);
    entries = await getSessionCardio(id);
    expect(entries[0].syncState).toBe("synced");
    expect(entries[0].serverId).not.toBeNull();
    expect(await pendingCount(id)).toBe(0);
  });

  it("deletes a synced cardio entry via DELETE on next sync", async () => {
    const { id, date } = await newSession();
    mockOnline();
    const row = await logCardio({
      sessionId: id, date, exerciseId: "stair_machine", exerciseName: "Stairs",
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

describe("session composition (local-only attach)", () => {
  beforeEach(mockOnline);

  it("attaches block exercises, dedupes, and removes", async () => {
    const { id } = await newSession();
    await attachToComposition(
      id,
      [
        { exerciseId: "machine_ab_crunch", exerciseName: "Ab crunch", loadType: "machine_selectorized", portable: false, conditioningOnly: false, provenance: "curated", untagged: false },
        { exerciseId: "hanging_leg_raise", exerciseName: "Leg raise", loadType: "bodyweight", portable: true, conditioningOnly: false, provenance: "curated", untagged: false },
      ],
      "block:Abs"
    );
    // Attaching an overlapping set again shouldn't duplicate.
    await attachToComposition(
      id,
      [{ exerciseId: "machine_ab_crunch", exerciseName: "Ab crunch", loadType: "machine_selectorized", portable: false, conditioningOnly: false, provenance: "curated", untagged: false }],
      "block:Abs"
    );
    let comp = await getSessionComposition(id);
    expect(comp).toHaveLength(2);
    expect(comp.map((c) => c.exerciseId)).toContain("machine_ab_crunch");

    await removeFromComposition(id, "machine_ab_crunch");
    comp = await getSessionComposition(id);
    expect(comp).toHaveLength(1);
    expect(comp[0].exerciseId).toBe("hanging_leg_raise");
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
        { exerciseId: "back_squat", exerciseName: "Back Squat", loadType: "free_weight", portable: false, conditioningOnly: false, provenance: "curated", untagged: false, params: null },
      ],
      sets: [
        { id: 5001, exerciseId: "back_squat", machineId: null, setIndex: 1, setType: "working", load: "225", reps: 5, effort: "near_failure", rir: null },
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

    const comp = await getSessionComposition("srv-session-1");
    expect(comp).toHaveLength(1);
    expect(comp[0].exerciseName).toBe("Back Squat");

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
