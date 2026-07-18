"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { editSet, deleteSet, type SessionSet, type SetSide } from "@/lib/sessionStore";
import { EFFORT_LABEL, EFFORT_OPTIONS, type EffortTag } from "./shared";

// One logged set: a read-only row (rows show information). Tapping it reveals
// its controls (Edit / Delete / + Drop) — controls appear on demand; the card
// owns which row is revealed so only one action row is open at a time.
// Editing swaps to the same inline form as before (logic moved verbatim).
export function SetRow({
  set,
  isDrop,
  unilateral,
  revealed,
  onToggleReveal,
  onChanged,
  onDrop,
}: {
  set: SessionSet;
  isDrop: boolean;
  unilateral: boolean;
  revealed: boolean;
  onToggleReveal: () => void;
  onChanged: () => void;
  onDrop: (parent: SessionSet) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [load, setLoad] = useState(set.load);
  const [reps, setReps] = useState(set.reps);
  const [effort, setEffort] = useState<EffortTag | null>(set.effort);
  const [side, setSide] = useState<SetSide | null>(set.side ?? null);
  const pending = set.syncState !== "synced";

  async function save() {
    if (reps < 1 || load < 0) return;
    await editSet(set.localId!, { load, reps, effort, ...(side != null ? { side } : {}) });
    setEditing(false);
    onChanged();
  }
  async function remove() {
    await deleteSet(set.localId!);
    onChanged();
  }

  if (editing) {
    return (
      <li>
        <div className={styles.setEditRow} style={isDrop ? { paddingLeft: 22 } : undefined}>
          <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 64 }} />
          <span>×</span>
          <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 52 }} />
          {/* Same effort pattern as the input trio — one dropdown everywhere. */}
          <select value={effort ?? ""} onChange={(e) => setEffort((e.target.value || null) as EffortTag | null)} className={styles.selectQuiet}>
            <option value="">effort —</option>
            {EFFORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {(unilateral || set.side != null) && (
            // The condition is "the EXERCISE is unilateral" — not "the set already
            // has a side" — so a historical set logged before the tag existed can
            // have its side ADDED here, not just flipped.
            <span className={styles.seg}>
              {(["left", "right", "both"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSide(s)} className={side === s ? styles.segActive : styles.segBtn}>
                  {s === "left" ? "L" : s === "right" ? "R" : "Alternating"}
                </button>
              ))}
            </span>
          )}
          <button type="button" onClick={save} className={styles.smallBtn}>Save</button>
          <button type="button" onClick={() => setEditing(false)} className={styles.smallBtn}>Cancel</button>
        </div>
      </li>
    );
  }

  const sideTag = set.side === "left" ? " · L" : set.side === "right" ? " · R" : set.side === "both" ? " · Alt" : "";
  // Lead with the number that matters (the effective load); the transparent
  // breakdown stays, but as a small muted suffix shown only when an offset
  // exists — no more equation soup.
  const hasOffset = set.builtinOffset != null && set.builtinOffset !== 0 && set.loadEntered != null;

  return (
    <li>
      <div className={isDrop ? styles.setDropWrap : undefined}>
        <button type="button" className={`${styles.setRow} ${revealed ? styles.setRowActive : ""}`} onClick={onToggleReveal}>
          <span className={pending ? styles.setTickPending : styles.setTick} title={pending ? "Not yet synced" : "Synced"}>
            {pending ? "○" : "✓"}
          </span>
          <span className={styles.setMain}>
            {isDrop && <span className={styles.setKind}>↳ drop · </span>}
            {!isDrop && set.setType === "warmup" && <span className={styles.setKind}>warm-up · </span>}
            {set.load} × {set.reps}
            {sideTag}
            {hasOffset && <span className={styles.setSuffix}> · {set.loadEntered} + {set.builtinOffset} built-in</span>}
          </span>
          {set.effort && <span className={styles.setEffort}>{EFFORT_LABEL[set.effort]}</span>}
          <span className={styles.setChevron} aria-hidden="true">›</span>
        </button>
        {revealed && (
          <div className={styles.setActions}>
            <button type="button" onClick={() => { setLoad(set.load); setReps(set.reps); setEffort(set.effort); setSide(set.side ?? null); setEditing(true); }}>
              Edit
            </button>
            <button type="button" onClick={remove}>Delete</button>
            <button type="button" onClick={() => onDrop(set)} title="Add a drop-set segment under this set">+ Drop</button>
          </div>
        )}
      </div>
    </li>
  );
}
