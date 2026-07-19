"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import styles from "./editors.module.css";
import { api, type EditorExercise } from "./types";

// Exercise target edit sheet — everything the old always-visible row inputs
// did, behind a tap. Target semantics untouched: sets / repRange / rirTarget
// stored exactly as before (this relabels and relocates, never reinterprets).
// Cardio shows only what applies: sets (+ the prescribed duration, read-only —
// duration isn't an editable target field today).
export function TargetSheet({
  ex,
  position,
  total,
  onChanged,
  onClose,
}: {
  ex: EditorExercise;
  position: number;
  total: number;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [targetSets, setTargetSets] = useState(String(ex.targetSets));
  const [repRange, setRepRange] = useState(ex.repRange ?? "");
  const [rirTarget, setRirTarget] = useState(ex.rirTarget ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const durationMin =
    ex.params && typeof ex.params.duration_min === "number" ? (ex.params.duration_min as number) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/program-exercises/${ex.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          targetSets: Number(targetSets) || 0,
          repRange: ex.conditioningOnly ? ex.repRange : repRange.trim() === "" ? null : repRange.trim(),
          rirTarget: ex.conditioningOnly ? ex.rirTarget : rirTarget.trim() === "" ? null : rirTarget.trim(),
        }),
      });
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't save — try again.");
      setBusy(false);
    }
  }

  async function move(direction: "up" | "down") {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/program-exercises/${ex.id}/move`, { method: "POST", body: JSON.stringify({ direction }) });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/program-exercises/${ex.id}`, { method: "DELETE" });
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't remove — try again.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={ex.exerciseName}
      subtitle={ex.conditioningOnly ? "Cardio — sets and prescribed duration; rep range and effort don't apply." : undefined}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldHalf}>
            <span className={styles.fieldLabel}>Sets</span>
            <input
              type="number"
              className={styles.fieldInput}
              value={targetSets}
              onChange={(e) => setTargetSets(e.target.value)}
              min={0}
            />
          </label>
          {!ex.conditioningOnly && (
            <label className={styles.fieldHalf}>
              <span className={styles.fieldLabel}>Rep range</span>
              <input
                className={styles.fieldInput}
                value={repRange}
                onChange={(e) => setRepRange(e.target.value)}
                placeholder="e.g. 8-12"
              />
            </label>
          )}
          {!ex.conditioningOnly && (
            <label className={styles.fieldHalf}>
              <span className={styles.fieldLabel}>Effort (RIR)</span>
              <input
                className={styles.fieldInput}
                value={rirTarget}
                onChange={(e) => setRirTarget(e.target.value)}
                placeholder="e.g. 2"
              />
            </label>
          )}
        </div>
        {durationMin != null && (
          <p className={styles.fieldNote} style={{ marginTop: 8 }}>
            Prescribed: {durationMin} min (edited when logging, not here).
          </p>
        )}
        {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
        <div className={styles.sheetActions} style={{ marginTop: 12 }}>
          <button type="submit" className={styles.primaryBtn} disabled={busy}>
            Save target
          </button>
        </div>
      </form>

      <div className={styles.sectionLabel}>Order</div>
      <div className={styles.movePair}>
        <button type="button" className={styles.moveBtn} onClick={() => move("up")} disabled={busy || position === 0}>
          ↑ Move up
        </button>
        <button
          type="button"
          className={styles.moveBtn}
          onClick={() => move("down")}
          disabled={busy || position === total - 1}
        >
          ↓ Move down
        </button>
      </div>

      <div className={styles.sectionLabel}>Remove</div>
      {confirmRemove ? (
        <div className={styles.sheetActions}>
          <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={remove} disabled={busy}>
            Remove from this list
          </button>
          <button type="button" className={styles.quietBtn} onClick={() => setConfirmRemove(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div className={styles.sheetActions}>
          <button type="button" className={styles.dangerBtn} style={{ flex: 1 }} onClick={() => setConfirmRemove(true)}>
            Remove exercise…
          </button>
        </div>
      )}
    </Sheet>
  );
}
