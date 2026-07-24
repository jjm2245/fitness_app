"use client";

import { useState } from "react";
import styles from "./session.module.css";

import { digitsToSeconds, fmtRest } from "./shared";

// The rest EDGE between two logged rows — honest to the model: N rows ⇒ N−1
// rests, each stored as the following row's restBefore. Renders as a thin
// connector (│ 1:34 rest · est); tap to correct with the same digits-only
// mm:ss mask — a corrected value becomes source "user". Value+callback props,
// so the strength card and the metric card share ONE rest connector.
export function RestConnector({
  restSeconds,
  restSource,
  onSave,
}: {
  restSeconds: number | null;
  restSource: string | null;
  onSave: (seconds: number) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [digits, setDigits] = useState(""); // raw digit buffer; the mask formats it

  // Source tags (owner convention): timed tagged, derived tagged (a derived
  // number must not masquerade as measured/entered), user/manual bare.
  // 0 is a KNOWN none (deliberately no rest — e.g. unilateral L→R) and shows
  // as "no rest"; null stays the honest unknown ("rest —").
  const label =
    restSeconds == null
      ? "rest —"
      : restSeconds === 0
      ? "no rest"
      : restSource === "derived"
      ? `~${fmtRest(restSeconds)} rest · derived`
      : restSource === "timed"
      ? `${fmtRest(restSeconds)} rest · timed`
      : `${fmtRest(restSeconds)} rest`;

  async function save() {
    if (!digits) return setEditing(false);
    await onSave(digitsToSeconds(digits));
    setEditing(false);
  }
  // One-tap known-zero: logging "there was no rest" shouldn't mean typing 0:00.
  async function saveNone() {
    await onSave(0);
    setEditing(false);
  }

  return (
    <li aria-label="Rest between entries">
      <div className={styles.restEdge}>
        <span className={styles.restRule} />
        {editing ? (
          <span className={styles.restEditWrap}>
            <input
              className={styles.restEditInput}
              value={digits ? fmtRest(digitsToSeconds(digits)) : ""}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(-4))}
              inputMode="numeric"
              placeholder="m:ss"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            />
            <button type="button" onClick={save} className={styles.restEditSave}>✓</button>
            <button type="button" onClick={saveNone} className={styles.restEditSave} title="There was deliberately no rest before this set">none</button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.restBtn}
            title={restSeconds == null ? "Rest unknown — tap to set" : "Tap to correct the rest"}
            onClick={() => {
              setDigits(restSeconds != null ? String(Math.floor(restSeconds / 60)) + String(restSeconds % 60).padStart(2, "0") : "");
              setEditing(true);
            }}
          >
            {label}
          </button>
        )}
      </div>
    </li>
  );
}
