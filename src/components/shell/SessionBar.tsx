"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SessionBar.module.css";
import { subscribeRestTimer } from "@/lib/restTimerBus";

// The session bar — replaces the global nav while logging (mode switch:
// navigating vs. training). Back chevron · live rest timer (mirrors the
// in-card timer via the display-only bus; hidden when idle) · Finish (n).
export function SessionBar({ finishCount, onFinish }: { finishCount: number; onFinish: () => void }) {
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
        <button type="button" className={styles.back} aria-label="Back to sessions" onClick={() => router.push("/sessions")}>
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
