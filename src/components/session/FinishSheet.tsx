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

  const rows: Array<{ id: string; name: string; tag: string }> = [];
  for (const o of occurrences) {
    const sets = setsByInstance.get(o.instanceId) ?? 0;
    const cardio = cardioByInstance.get(o.instanceId) ?? 0;
    const done = completed.has(o.instanceId);
    if (sets > 0) rows.push({ id: o.instanceId, name: o.exerciseName, tag: `×${sets}` });
    else if (cardio > 0) rows.push({ id: o.instanceId, name: o.exerciseName, tag: "cardio" });
    else if (done) rows.push({ id: o.instanceId, name: o.exerciseName, tag: "done, 0 logged" });
  }
  const exerciseCount = rows.length;

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

      {rows.length === 0 ? (
        <p className={styles.finishSummaryLine}>Nothing logged yet — you can still finish, or keep logging.</p>
      ) : (
        // Compact name · ×sets grid; capped height with internal scroll so it
        // stays readable however long the session gets.
        <div className={styles.finishGrid}>
          {rows.map((r) => (
            <div key={r.id} className={styles.finishGridRow}>
              <span className={styles.finishGridName}>{r.name}</span>
              <span className={styles.finishGridTag}>{r.tag}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.finishSyncRow}>
        <span className={`${styles.dot} ${pending > 0 ? styles.dotAmber : styles.dotGreen}`} />
        <span>{pending > 0 ? `${pending} ${pending === 1 ? "change" : "changes"} will sync when you're back online` : "All changes synced"}</span>
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
