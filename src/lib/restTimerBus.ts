// The running rest timer, held ABOVE the route so leaving the logging screen
// doesn't stop it. Going to Equipment to record a stack max is an ordinary
// thing to do inside ninety seconds.
//
// WALL-CLOCK BY CONSTRUCTION: the only thing stored is the START TIMESTAMP, and
// every reader derives `Date.now() - startedAt`. Nothing counts ticks, so
// nothing can drift or pause — the intervals elsewhere exist purely to
// re-render a display, never to accumulate. That is what makes this survive
// navigation, a backgrounded tab (where timers are throttled or frozen), and a
// reload. This part was already true; what changed is that the value now
// outlives the route and the process.
//
// Still NOT part of the sync layer: nothing here reaches the server or logs
// anything. The card owns starting, stopping, and writing the rest to the next
// set; this only remembers that a rest is running and which card owns it.

const KEY = "fitness-app:rest-timer";

export interface RestTimer {
  /** Epoch ms the rest started. The single source of elapsed time. */
  startedAt: number;
  sessionId: string;
  /** The occurrence that owns it — only that card restores and consumes it. */
  instanceId: string;
}

type Listener = (timer: RestTimer | null) => void;

let current: RestTimer | null = null;
const listeners = new Set<Listener>();
let loaded = false;

function read(): RestTimer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as RestTimer;
    // A malformed or half-written record is treated as NO timer, never as a
    // rest that started at NaN — which would render an absurd elapsed time and
    // then write it onto a set.
    if (typeof v?.startedAt !== "number" || !Number.isFinite(v.startedAt)) return null;
    if (typeof v.sessionId !== "string" || typeof v.instanceId !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

/** The live timer, rehydrating from storage on first read — after a reload the
 *  module is fresh but the rest is still genuinely running. */
export function getRestTimer(): RestTimer | null {
  if (!loaded) {
    current = read();
    loaded = true;
  }
  return current;
}

/** Start (or clear) the rest. Persisted, so a reload resumes the same count. */
export function publishRestTimer(timer: RestTimer | null): void {
  loaded = true;
  current = timer;
  if (typeof window !== "undefined") {
    try {
      if (timer) window.localStorage.setItem(KEY, JSON.stringify(timer));
      else window.localStorage.removeItem(KEY);
    } catch {
      /* private mode / quota — the in-memory value still drives this session */
    }
  }
  for (const l of listeners) l(current);
}

export function subscribeRestTimer(listener: Listener): () => void {
  listeners.add(listener);
  listener(getRestTimer()); // deliver the live state immediately on mount
  return () => {
    listeners.delete(listener);
  };
}

/** Seconds since the rest started — derived, never accumulated. */
export function restElapsedSeconds(timer: RestTimer | null, now = Date.now()): number | null {
  if (!timer) return null;
  return Math.max(0, Math.floor((now - timer.startedAt) / 1000));
}

export function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
