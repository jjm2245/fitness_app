"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { editSet, type SessionSet } from "@/lib/sessionStore";
import { digitsToSeconds, fmtRest } from "./shared";

// The rest EDGE between two set rows — honest to the model: N sets ⇒ N−1
// rests, each stored as the following set's restBefore. Renders as a thin
// connector (│ 1:34 rest · est); tap to correct with the same digits-only
// mm:ss mask as before — a corrected value becomes source "user".
export function RestConnector({ set, onChanged }: { set: SessionSet; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [digits, setDigits] = useState(""); // raw digit buffer; the mask formats it

  // Source tags (owner convention): timed tagged, derived tagged (a derived
  // number must not masquerade as measured/entered), user/manual bare.
  // 0 is a KNOWN none (deliberately no rest — e.g. unilateral L→R) and shows
  // as "no rest"; null stays the honest unknown ("rest —").
  const label =
    set.restSeconds == null
      ? "rest —"
      : set.restSeconds === 0
      ? "no rest"
      : set.restSource === "derived"
      ? `~${fmtRest(set.restSeconds)} rest · derived`
      : set.restSource === "timed"
      ? `${fmtRest(set.restSeconds)} rest · timed`
      : `${fmtRest(set.restSeconds)} rest`;

  async function save() {
    if (!digits) return setEditing(false);
    await editSet(set.localId!, { restSeconds: digitsToSeconds(digits), restSource: "user" });
    setEditing(false);
    onChanged();
  }
  // One-tap known-zero: logging "there was no rest" shouldn't mean typing 0:00.
  async function saveNone() {
    await editSet(set.localId!, { restSeconds: 0, restSource: "user" });
    setEditing(false);
    onChanged();
  }

  return (
    <li aria-label="Rest between sets">
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
            title={set.restSeconds == null ? "Rest unknown — tap to set" : "Tap to correct the rest"}
            onClick={() => {
              setDigits(set.restSeconds != null ? String(Math.floor(set.restSeconds / 60)) + String(set.restSeconds % 60).padStart(2, "0") : "");
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
