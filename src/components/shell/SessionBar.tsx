"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SessionBar.module.css";
import { subscribeRestTimer } from "@/lib/restTimerBus";

// The session bar — replaces the global nav while logging (mode switch:
// navigating vs. training). Back chevron · live rest timer (mirrors the
// in-card timer via the display-only bus; hidden when idle) · Finish (n).
export function SessionBar({
  finishCount,
  onFinish,
  onBack,
}: {
  finishCount: number;
  onFinish: () => void;
  // Optional back override — the log page uses it to discard an empty
  // session before leaving. Defaults to plain back-with-fallback.
  onBack?: () => void;
}) {
  const router = useRouter();
  const [startMs, setStartMs] = useState<number | null>(null);
  const [, force] = useState(0);

  useEffect(() => subscribeRestTimer(setStartMs), []);
  useEffect(() => {
    if (startMs == null) return;
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [startMs]);

  const elapsed = startMs != null ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : null;
  const mmss =
    elapsed != null ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : null;

  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.back}
          aria-label="Back"
          // Return to wherever the session was entered from (Home / Train /
          // History). Fresh loads and deep links have no in-app history
          // (history.length <= 1 in a new tab / standalone PWA launch) — fall
          // back to History so back never dead-ends.
          onClick={() => {
            if (onBack) return onBack();
            if (window.history.length > 1) router.back();
            else router.push("/sessions");
          }}
        >
          <svg width="11" height="18" viewBox="0 0 11 18" fill="none" aria-hidden="true">
            <path d="M9.5 1.5L2 9l7.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
        {mmss != null ? (
          <span className={styles.timer} title="Rest timer">
            {mmss}
          </span>
        ) : (
          <span className={styles.timerIdle} />
        )}
        <button type="button" className={styles.finish} onClick={onFinish}>
          Finish ({finishCount})
        </button>
      </div>
    </>
  );
}
