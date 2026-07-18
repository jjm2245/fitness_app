"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { editSessionMeta, type LocalSession } from "@/lib/sessionStore";

// One-line session header: name · date · time ✎ (tap to edit — the same
// stable-date + user-editable-time behavior as before, moved verbatim) plus
// the sync status dot from the History pattern: green synced / amber pending
// (drains on its own) / red needs-action; tap expands detail + the heals.
export function SessionHeader({
  session,
  pending,
  syncError,
  onChanged,
  onSyncNow,
  onPull,
  onReconcile,
}: {
  session: LocalSession;
  pending: number;
  syncError: "auth" | "network" | "server" | null;
  onChanged: () => void;
  onSyncNow: () => void;
  onPull: () => void;
  onReconcile: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dateVal, setDateVal] = useState(session.date);
  const [timeVal, setTimeVal] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  function open() {
    setDateVal(session.date);
    if (session.firstFinishedAt) {
      const t = new Date(session.firstFinishedAt);
      setTimeVal(`${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`);
    } else setTimeVal("");
    setEditing(true);
  }

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return;
    let firstFinishedAt: string | null = null;
    if (timeVal) {
      const [y, m, d] = dateVal.split("-").map(Number);
      const [hh, mm] = timeVal.split(":").map(Number);
      firstFinishedAt = new Date(y, m - 1, d, hh, mm).toISOString(); // local wall clock → UTC storage
    }
    await editSessionMeta(session.id, { date: dateVal, firstFinishedAt });
    setEditing(false);
    onChanged();
  }

  // Display from the STABLE anchors (session date + first-finish time), local
  // calendar parts — never the re-stampable finishedAt.
  const [y, m, d] = session.date.split("-").map(Number);
  const dateLabel = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeLabel = session.firstFinishedAt
    ? ` · ${new Date(session.firstFinishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";

  const conflict = !!session.occurrenceConflict;
  const dirty = !!session.occurrencesDirty;
  const dotClass = conflict || (syncError && syncError !== "network")
    ? styles.dotRed
    : pending > 0
    ? styles.dotAmber
    : styles.dotGreen;
  const dotLabel = conflict ? "Needs attention" : pending > 0 ? "Pending sync" : "Synced";

  return (
    <header className={styles.sessionHeader}>
      <div className={styles.sessionHeaderRow}>
        {editing ? (
          <span className={styles.headerEdit}>
            <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
            <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} title="Optional — leave blank for no time" />
            <button type="button" onClick={save} className={styles.smallBtn}>Save</button>
            <button type="button" onClick={() => setEditing(false)} className={styles.smallBtn}>Cancel</button>
            {session.firstFinishedSource === "user" && <span className={styles.chip}>set by you</span>}
          </span>
        ) : (
          <button
            type="button"
            className={styles.headerLine}
            onClick={open}
            title={`Tap to correct this session's date/time${session.firstFinishedSource === "user" ? " — currently set by you" : ""}`}
          >
            <span className={styles.headerName}>{session.origin}</span>
            <span className={styles.headerWhen}>
              {dateLabel}{timeLabel} <span aria-hidden="true">✎</span>
            </span>
          </button>
        )}
        <button
          type="button"
          className={styles.headerDotBtn}
          title={dotLabel}
          aria-label={`Sync: ${dotLabel}`}
          onClick={() => setDetailOpen((o) => !o)}
        >
          <span className={`${styles.dot} ${dotClass}`} />
        </button>
      </div>

      {syncError === "auth" && (
        <div className={styles.authBanner}>
          Session expired — <a href={`/login?next=${encodeURIComponent(`/log/${session.id}`)}`}>re-login to sync</a>
        </div>
      )}

      {detailOpen && (
        <div className={styles.headerSyncDetail}>
          <span>
            {conflict
              ? "The server has logged sets this device doesn't — pull its copy down."
              : pending > 0
              ? `${pending} ${pending === 1 ? "change" : "changes"} pending — ${syncError === "network" ? "offline, syncs when you reconnect." : "syncs automatically."}`
              : "Synced with the server."}
          </span>
          <div className={styles.syncActions}>
            <button type="button" onClick={onSyncNow}>Sync now</button>
            {conflict && (
              <button type="button" onClick={onPull} title="Replace the local copy with the server's (your logged sets on the server are kept).">
                Pull from server
              </button>
            )}
            {dirty && !conflict && (
              <button type="button" onClick={onReconcile} title="Re-push this session's exercise list; the server keeps any occurrence that still has logged sets.">
                Reconcile
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
