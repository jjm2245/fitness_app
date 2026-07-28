"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import styles from "./sessions.module.css";

// Add or edit one timeline note. A bottom sheet, like every other editor in the
// app — the list behind it doesn't move while you type.

export interface TimelineNote {
  id: number;
  startDate: string;
  endDate: string | null;
  kind: string | null;
  notes: string;
}

/** Suggestions, not a vocabulary. Free text underneath, so "moved house" and
 *  "gym closed" don't need a migration to exist. */
const KINDS = ["illness", "injury", "travel", "deload", "other"] as const;

export function TimelineNoteSheet({
  note,
  defaultStart,
  defaultEnd,
  onClose,
  onSaved,
}: {
  /** Present = editing; absent = adding. */
  note?: TimelineNote;
  /** Pre-fills when adding from a gap, so the dates are already right. */
  defaultStart?: string;
  defaultEnd?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState(note?.startDate ?? defaultStart ?? todayIso());
  const [end, setEnd] = useState(note?.endDate ?? defaultEnd ?? "");
  const [kind, setKind] = useState(note?.kind ?? "");
  const [text, setText] = useState(note?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await fetch(note ? `/api/timeline-notes/${note.id}` : "/api/timeline-notes", {
      method: note ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      // "" for the end means CLEAR IT — re-opening a note closed too early has
      // to be possible, so empty is sent explicitly rather than omitted.
      body: JSON.stringify({ startDate: start, endDate: end === "" ? null : end, kind, notes: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      // The server phrases the date-order problem in words; show it as-is
      // rather than a generic failure.
      return setErr(j.error ?? "Couldn't save that note.");
    }
    onSaved();
    onClose();
  }

  async function remove() {
    if (!note) return;
    setBusy(true);
    const res = await fetch(`/api/timeline-notes/${note.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setErr("Couldn't delete that note.");
    onSaved();
    onClose();
  }

  return (
    <Sheet
      title={note ? "Edit note" : "What happened?"}
      subtitle="Explains a stretch of time — illness, injury, travel, a deload. Leave the end open if it's still going."
      onClose={onClose}
    >
      {err && <p className={styles.noteError} role="alert">{err}</p>}

      <div className={styles.tlField}>
        <span className={styles.tlLabel}>From</span>
        <input type="date" value={start} max={todayIso()} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
      </div>

      <div className={styles.tlField}>
        <span className={styles.tlLabel}>To</span>
        <input type="date" value={end} max={todayIso()} onChange={(e) => setEnd(e.target.value)} aria-label="End date" />
        {/* Setting an end is the natural follow-up to every open note, and
            clearing it again has to be just as easy. */}
        {end === "" ? (
          <button type="button" className={styles.tlQuiet} onClick={() => setEnd(todayIso())}>
            ended today
          </button>
        ) : (
          <button type="button" className={styles.tlQuiet} onClick={() => setEnd("")}>
            still ongoing
          </button>
        )}
      </div>

      <div className={styles.tlField}>
        <span className={styles.tlLabel}>Kind</span>
        <span className={styles.tlKinds}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={kind === k ? styles.tlKindOn : styles.tlKind}
              // Tapping the active one clears it — an untyped note is fine.
              onClick={() => setKind(kind === k ? "" : k)}
            >
              {k}
            </button>
          ))}
        </span>
      </div>

      <textarea
        className={styles.tlText}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="what happened, in your words"
        aria-label="Note text"
        rows={4}
      />

      <div className={styles.tlActions}>
        <button type="button" className={styles.tlSave} onClick={save} disabled={busy || text.trim() === ""}>
          {busy ? "Saving…" : note ? "Save changes" : "Add note"}
        </button>
        {note && !confirmDelete && (
          <button type="button" className={styles.tlDanger} onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>

      {note && confirmDelete && (
        <div className={styles.tlConfirm}>
          <span>Delete this note?</span>
          <button type="button" className={styles.tlDanger} onClick={remove} disabled={busy}>Delete</button>
          <button type="button" className={styles.tlQuiet} onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      )}
    </Sheet>
  );
}

function todayIso(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
