// Display-only bridge between the in-card rest timer (state lives inside the
// logging screen's exercise card) and the session bar, which mirrors it. Not
// part of the sync layer: nothing here persists or logs anything — the card
// still owns starting/stopping and writing the rest to the next set.

type Listener = (startMs: number | null) => void;

let current: number | null = null;
const listeners = new Set<Listener>();

// Card → bar: the timer started at `startMs` (epoch ms), or stopped (null).
export function publishRestTimer(startMs: number | null): void {
  current = startMs;
  for (const l of listeners) l(current);
}

export function subscribeRestTimer(listener: Listener): () => void {
  listeners.add(listener);
  listener(current); // deliver the live state immediately on mount
  return () => {
    listeners.delete(listener);
  };
}
