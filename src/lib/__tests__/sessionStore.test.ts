import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  logSet,
  editSet,
  deleteSet,
  getSessionSets,
  finishSession,
  getSessionMeta,
  sync,
  pendingCount,
} from "../sessionStore";

// The session store is the load-bearing offline layer. These tests drive its
// sync state machine with fetch mocked online/offline — the behaviors that
// can't be exercised through the browser preview (which has no network toggle),
// especially "correct a set that already synced, while offline" (the user's
// explicit same-session requirement).

const baseInput = {
  exerciseId: "deadlift",
  exerciseName: "Deadlift",
  machineId: null,
  setType: "working" as const,
  load: 100,
  reps: 8,
  rir: 2,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logging + sync", () => {
  beforeEach(mockOnline);

  it("logs a set as pending, then sync marks it synced with a server id", async () => {
    const date = freshDate();
    const row = await logSet({ ...baseInput, date });
    expect(row.syncState).toBe("pending_create");

    let sets = await getSessionSets(date);
    expect(sets).toHaveLength(1);
    expect(sets[0].serverId).toBeNull();

    const result = await sync();
    expect(result.created).toBe(1);

    sets = await getSessionSets(date);
    expect(sets[0].syncState).toBe("synced");
    expect(sets[0].serverId).not.toBeNull();
  });
});

describe("offline logging", () => {
  it("keeps a set logged and visible while offline, then syncs when back online", async () => {
    const date = freshDate();
    mockOffline();
    const row = await logSet({ ...baseInput, date });
    await sync(); // fails silently
    let sets = await getSessionSets(date);
    expect(sets).toHaveLength(1);
    expect(sets[0].syncState).toBe("pending_create"); // still queued
    expect(await pendingCount(date)).toBe(1);
    void row;

    mockOnline();
    const result = await sync();
    expect(result.created).toBe(1);
    sets = await getSessionSets(date);
    expect(sets[0].syncState).toBe("synced");
    expect(await pendingCount(date)).toBe(0);
  });
});

describe("same-session edit after sync, offline (the key requirement)", () => {
  it("edits an already-synced set while offline and re-syncs the correction", async () => {
    const date = freshDate();
    // Log + sync online first (the set gets a serverId).
    mockOnline();
    const row = await logSet({ ...baseInput, date, load: 135 });
    await sync();
    let sets = await getSessionSets(date);
    expect(sets[0].syncState).toBe("synced");
    const serverId = sets[0].serverId;

    // Now offline: fat-finger correction seconds later.
    mockOffline();
    await editSet(row.localId!, { load: 145 });
    sets = await getSessionSets(date);
    expect(sets[0].load).toBe(145); // reflected immediately, offline
    expect(sets[0].syncState).toBe("pending_update");
    expect(sets[0].serverId).toBe(serverId); // same server row, will be PATCHed
    await sync(); // fails, stays pending_update
    expect((await getSessionSets(date))[0].syncState).toBe("pending_update");

    // Back online: the correction PATCHes through.
    mockOnline();
    const result = await sync();
    expect(result.updated).toBe(1);
    expect((await getSessionSets(date))[0].syncState).toBe("synced");
  });
});

describe("delete semantics", () => {
  it("hard-removes a never-synced set without any server call", async () => {
    const date = freshDate();
    mockOffline();
    const row = await logSet({ ...baseInput, date });
    await deleteSet(row.localId!);
    expect(await getSessionSets(date)).toHaveLength(0);
    // sync has nothing to do — no fetch should have mattered
    const result = await sync();
    expect(result.deleted).toBe(0);
  });

  it("soft-deletes a synced set, hides it immediately, and DELETEs on next sync", async () => {
    const date = freshDate();
    mockOnline();
    const row = await logSet({ ...baseInput, date });
    await sync();

    mockOffline();
    await deleteSet(row.localId!);
    expect(await getSessionSets(date)).toHaveLength(0); // hidden right away, offline

    mockOnline();
    const result = await sync();
    expect(result.deleted).toBe(1);
    expect(await getSessionSets(date)).toHaveLength(0); // gone for good
  });
});

describe("finish session", () => {
  it("stamps finish offline and syncs it when back online; re-finishing re-stamps", async () => {
    const date = freshDate();
    mockOffline();
    const meta = await finishSession(date);
    expect(meta.finishedAt).not.toBeNull();
    expect(meta.finishSynced).toBe(false);
    expect(await pendingCount(date)).toBe(1); // unsynced finish counts as pending

    mockOnline();
    const result = await sync();
    expect(result.finished).toBe(1);
    expect((await getSessionMeta(date))?.finishSynced).toBe(true);

    // Not a one-way door: finishing again re-stamps and needs re-sync.
    const before = (await getSessionMeta(date))!.finishedAt!;
    await new Promise((r) => setTimeout(r, 5));
    const again = await finishSession(date);
    expect(again.finishSynced).toBe(false);
    expect(new Date(again.finishedAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});
