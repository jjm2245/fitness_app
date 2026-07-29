import { describe, it, expect, beforeEach } from "vitest";

// The suite runs in the "node" environment, so `window` has to be stubbed the
// same way sessionStore's tests stub localStorage. The module reads through
// `window.localStorage` and tolerates its absence (SSR), so this is the only
// scaffolding needed.
const lsStore = new Map<string, string>();
const storage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, v),
  removeItem: (k: string) => void lsStore.delete(k),
  clear: () => lsStore.clear(),
  key: () => null,
  length: 0,
} as Storage;
(globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: storage };
(globalThis as unknown as { localStorage: Storage }).localStorage = storage;
import {
  publishRestTimer,
  getRestTimer,
  subscribeRestTimer,
  restElapsedSeconds,
  formatRest,
} from "../restTimerBus";

const KEY = "fitness-app:rest-timer";
const timer = { startedAt: 1_000_000, sessionId: "s1", instanceId: "i1" };

beforeEach(() => {
  lsStore.clear();
  publishRestTimer(null);
});

describe("elapsed is DERIVED, never accumulated", () => {
  it("comes from the stored start, so a missed tick costs nothing", () => {
    // The whole point: no interval contributes to this number. A frozen or
    // throttled tab (or a process restart) resumes at the correct value.
    expect(restElapsedSeconds(timer, timer.startedAt + 59_000)).toBe(59);
    expect(restElapsedSeconds(timer, timer.startedAt + 3_600_000)).toBe(3600);
  });

  it("never goes negative if the clock moves backwards", () => {
    expect(restElapsedSeconds(timer, timer.startedAt - 5_000)).toBe(0);
  });

  it("is null when nothing is running", () => {
    expect(restElapsedSeconds(null)).toBeNull();
  });

  it("formats mm:ss", () => {
    expect(formatRest(0)).toBe("0:00");
    expect(formatRest(9)).toBe("0:09");
    expect(formatRest(90)).toBe("1:30");
    expect(formatRest(605)).toBe("10:05");
  });
});

describe("the timer outlives the route", () => {
  it("persists, so a reload resumes the SAME rest rather than restarting it", () => {
    publishRestTimer(timer);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(timer);
  });

  it("clearing removes the record", () => {
    publishRestTimer(timer);
    publishRestTimer(null);
    expect(storage.getItem(KEY)).toBeNull();
    expect(getRestTimer()).toBeNull();
  });

  it("delivers the live timer to a subscriber mounting later — the whole point of the off-screen pill", () => {
    publishRestTimer(timer);
    let seen: unknown = "unset";
    const off = subscribeRestTimer((t) => { seen = t; });
    expect(seen).toEqual(timer);
    off();
  });

  it("a malformed record reads as NO timer, never as a rest starting at NaN", () => {
    // A NaN start would render an absurd elapsed time and then write it onto a
    // set, so a broken record must fail closed.
    for (const bad of ['{"startedAt":"soon"}', "{}", "not json", '{"startedAt":null,"sessionId":"s","instanceId":"i"}']) {
      storage.setItem(KEY, bad);
      publishRestTimer(null);
      storage.setItem(KEY, bad);
      expect(restElapsedSeconds(getRestTimer())).toBeNull();
    }
  });
});
