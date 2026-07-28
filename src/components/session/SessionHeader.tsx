"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
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
  const [error, setError] = useState<string | null>(null);
  const [noteVal, setNoteVal] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);

  function openNote() {
    setNoteVal(session.notes ?? "");
    setNoteEditing(true);
  }
  async function saveNote() {
    // Empty or whitespace-only clears to NULL — "no note" stays one state.
    await editSessionMeta(session.id, { notes: noteVal.trim() || null });
    setNoteEditing(false);
    onChanged();
  }
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
      // A session cannot end before it began. This is the guard that would have
      // caught log 3, whose recorded end sat half an hour before its first set.
      // Refuse rather than warn: there is no reading under which it's correct,
      // and the field is two taps to fix while the sheet is still open.
      const started = Date.parse(session.createdAt);
      if (Number.isFinite(started) && Date.parse(firstFinishedAt) < started) {
        setError(
          `That's before the session started (${new Date(started).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}).`
        );
        return;
      }
    }
    setError(null);
    // Empty or whitespace-only clears to NULL — "no note" is one state.
    // Date and time only. The note has its own line and its own save.
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
            <button type="button" onClick={() => { setError(null); setEditing(false); }} className={styles.smallBtn}>Cancel</button>
            {session.firstFinishedSource === "user" && <span className={styles.chip}>set by you</span>}
            {error && <span className={styles.metaError} role="alert">{error}</span>}
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

      {/* The note lives on its own line under the title, not behind the ✎ —
          that pencil sits beside the date and edits the date, which is what it
          looks like it does. A note you have to remember to go looking for
          defeats the point of writing one. One line of cost, and it only ever
          shows content or an invitation to add some. */}
      {/* The editor is a bottom SHEET, not an inline box. Inline pushed the
          exercise cards down the moment you tapped — the content moved under
          your thumb as you were about to type. A sheet slides over instead and
          the page behind it doesn't move, matching add-exercise, the unit sheet
          and the target sheet. */}
      {noteEditing && (
        <Sheet
          title={session.notes ? "Edit note" : "Note this session"}
          subtitle="An injury, bad sleep, a crowded gym, a deload — whatever explains this session later."
          onClose={() => setNoteEditing(false)}
        >
          <textarea
            className={styles.noteSheetText}
            value={noteVal}
            onChange={(e) => setNoteVal(e.target.value)}
            placeholder="what's worth remembering about this session?"
            aria-label="Session note"
            rows={5}
            autoFocus
          />
          <div className={styles.noteSheetActions}>
            <button type="button" className={styles.noteSheetSave} onClick={saveNote}>Save</button>
            <button type="button" className={styles.smallBtn} onClick={() => setNoteEditing(false)}>Cancel</button>
          </div>
        </Sheet>
      )}
      {session.notes ? (
        <button type="button" className={styles.noteLine} onClick={openNote} title={session.notes}>
          {session.notes}
        </button>
      ) : (
        <button type="button" className={styles.noteAdd} onClick={openNote}>+ Add note</button>
      )}

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
