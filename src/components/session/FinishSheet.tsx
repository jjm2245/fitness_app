"use client";

import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import type { LocalSession, Occurrence, SessionCardio, SessionSet } from "@/lib/sessionStore";

// The finish sheet (phase 2, Part 3): scales past 8 exercises. Three stat
// cells, then a compact one-line summary instead of one row per exercise.
// The confirm flow is unchanged — finish stays re-openable.
export function FinishSheet({
  session,
  occurrences,
  completed,
  sessionSets,
  sessionCardio,
  pending,
  onConfirm,
  onClose,
}: {
  session: LocalSession;
  occurrences: Occurrence[];
  completed: Set<string>;
  sessionSets: SessionSet[];
  sessionCardio: SessionCardio[];
  pending: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Same per-occurrence aggregation as before (one entry per performed
  // occurrence, in order, regardless of source).
  const setsByInstance = new Map<string, number>();
  for (const s of sessionSets) setsByInstance.set(s.instanceId, (setsByInstance.get(s.instanceId) ?? 0) + 1);
  const cardioByInstance = new Map<string, number>();
  for (const c of sessionCardio) cardioByInstance.set(c.instanceId, (cardioByInstance.get(c.instanceId) ?? 0) + 1);

  const parts: string[] = [];
  let exerciseCount = 0;
  for (const o of occurrences) {
    const sets = setsByInstance.get(o.instanceId) ?? 0;
    const cardio = cardioByInstance.get(o.instanceId) ?? 0;
    const done = completed.has(o.instanceId);
    if (sets > 0) {
      parts.push(`${o.exerciseName} ×${sets}`);
      exerciseCount += 1;
    } else if (cardio > 0) {
      parts.push(`${o.exerciseName} · cardio`);
      exerciseCount += 1;
    } else if (done) {
      parts.push(`${o.exerciseName} · done, nothing logged`);
      exerciseCount += 1;
    }
  }

  // Duration from the stable created→now span, same plausibility bounds as
  // History (1 min – 6 h); omitted rather than guessed outside them.
  const mins = Math.round((Date.now() - new Date(session.createdAt).getTime()) / 60_000);
  const duration = mins >= 1 && mins <= 360 ? `${mins}` : null;

  return (
    <Sheet
      title={`Finish ${session.origin}`}
      onClose={onClose}
      footer={session.finishedAt ? `Previously finished at ${new Date(session.finishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — finishing again re-stamps it.` : undefined}
    >
      <div className={styles.statCells}>
        <div className={styles.statCell}>
          <span className={styles.statValue}>{exerciseCount}</span>
          <span className={styles.statLabel}>exercises</span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statValue}>{sessionSets.length}</span>
          <span className={styles.statLabel}>sets</span>
        </div>
        <div className={styles.statCell}>
          <span className={styles.statValue}>{duration ?? "—"}</span>
          <span className={styles.statLabel}>{duration ? "minutes" : "duration"}</span>
        </div>
      </div>

      {parts.length === 0 ? (
        <p className={styles.finishSummaryLine}>Nothing logged yet — you can still finish, or keep logging.</p>
      ) : (
        <p className={styles.finishSummaryLine}>{parts.join(" · ")}</p>
      )}

      <div className={styles.finishSyncRow}>
        <span className={`${styles.dot} ${pending > 0 ? styles.dotAmber : styles.dotGreen}`} />
        <span>{pending > 0 ? `${pending} change(s) will sync when you're back online` : "All changes synced"}</span>
      </div>

      <div className={styles.finishActions}>
        <button type="button" onClick={onConfirm} className={styles.logBtn}>
          Confirm finish
        </button>
        <button type="button" onClick={onClose}>Keep logging</button>
      </div>
    </Sheet>
  );
}
