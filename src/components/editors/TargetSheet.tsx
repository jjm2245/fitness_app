"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import styles from "./editors.module.css";
import { api, type EditorExercise } from "./types";

// Exercise target edit sheet (3.1). The values are the per-session GOAL; leave
// anything blank to leave it unset. Invariant: stored values are never silently
// rewritten — "8-12" stores "8-12" (shown 8–12), a single "10" stores "10",
// RIR/sets store exactly what was entered, and a no-edit save is byte-identical.
// No reorder here (that moved to drag + sort). Reorder/Move controls removed.

const digits = (s: string) => s.replace(/[^\d]/g, "");
const decimal = (s: string) => {
  const c = s.replace(/[^\d.]/g, "");
  const i = c.indexOf(".");
  return i === -1 ? c : c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, "");
};

// A numeric input that can't take letters/symbols (inputmode numeric).
function NumField({
  label,
  value,
  onChange,
  placeholder,
  allowDecimal,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowDecimal?: boolean;
}) {
  return (
    <label className={styles.fieldHalf}>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      <input
        className={styles.fieldInput}
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={value}
        onChange={(e) => onChange((allowDecimal ? decimal : digits)(e.target.value))}
        placeholder={placeholder}
      />
    </label>
  );
}

export function TargetSheet({
  ex,
  onChanged,
  onClose,
}: {
  ex: EditorExercise;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── strength state ──
  const [targetSets, setTargetSets] = useState(ex.targetSets != null ? String(ex.targetSets) : "");
  const initRepRange = ex.repRange ?? "";
  const [repMode, setRepMode] = useState<"single" | "range">(initRepRange.includes("-") ? "range" : "single");
  const [repSingle, setRepSingle] = useState(initRepRange.includes("-") ? "" : initRepRange);
  const [repA, setRepA] = useState(initRepRange.includes("-") ? initRepRange.split("-")[0] : "");
  const [repB, setRepB] = useState(initRepRange.includes("-") ? initRepRange.split("-")[1] : "");
  const [rirTarget, setRirTarget] = useState(ex.rirTarget ?? "");

  // ── cardio state (edits the EXERCISE's params — applies everywhere) ──
  const p = ex.params ?? {};
  const dur = p.duration_min;
  const durIsRange = Array.isArray(dur) && dur.length === 2;
  const [durMode, setDurMode] = useState<"single" | "range">(durIsRange ? "range" : "single");
  const [durSingle, setDurSingle] = useState(durIsRange ? "" : typeof dur === "number" ? String(dur) : "");
  const [durA, setDurA] = useState(durIsRange ? String((dur as number[])[0]) : "");
  const [durB, setDurB] = useState(durIsRange ? String((dur as number[])[1]) : "");
  const [incline, setIncline] = useState(typeof p.incline === "number" ? String(p.incline) : "");
  const [speed, setSpeed] = useState(typeof p.speed === "number" ? String(p.speed) : "");

  function repRangeToStore(): string | null {
    if (repMode === "single") return repSingle.trim() === "" ? null : repSingle.trim();
    const a = repA.trim(), b = repB.trim();
    if (a !== "" && b !== "") return `${a}-${b}`;
    return a || b || null; // an incomplete range degrades to the one value / unset
  }

  async function saveStrength(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/program-exercises/${ex.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          targetSets: targetSets.trim() === "" ? null : Number(targetSets),
          repRange: repRangeToStore(),
          rirTarget: rirTarget.trim() === "" ? null : rirTarget.trim(),
        }),
      });
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't save — try again.");
      setBusy(false);
    }
  }

  async function saveCardio(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    // Merge over the exercise's existing params so unknown keys are preserved
    // and blanked fields are unset (deleted), never left as stale/null.
    const params: Record<string, unknown> = { ...(ex.params ?? {}) };
    if (durMode === "single") {
      if (durSingle.trim() !== "") params.duration_min = Number(durSingle);
      else delete params.duration_min;
    } else if (durA.trim() !== "" && durB.trim() !== "") {
      params.duration_min = [Number(durA), Number(durB)];
    } else {
      delete params.duration_min;
    }
    if (incline.trim() !== "") params.incline = Number(incline);
    else delete params.incline;
    if (speed.trim() !== "") params.speed = Number(speed);
    else delete params.speed;
    try {
      await api(`/api/exercises/${encodeURIComponent(ex.exerciseId)}`, {
        method: "PATCH",
        body: JSON.stringify({ params: Object.keys(params).length ? params : null }),
      });
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't save — try again.");
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

  const RepToggle = (
    <div className={styles.movePair}>
      <button type="button" className={repMode === "single" ? styles.toggleActive : styles.toggleBtn} onClick={() => setRepMode("single")}>
        Single
      </button>
      <button type="button" className={repMode === "range" ? styles.toggleActive : styles.toggleBtn} onClick={() => setRepMode("range")}>
        Range
      </button>
    </div>
  );

  return (
    <Sheet title={ex.exerciseName} onClose={onClose}>
      <div className={styles.sectionLabel}>Target</div>
      {ex.conditioningOnly ? (
        <form onSubmit={saveCardio}>
          <p className={styles.fieldNote}>What you&rsquo;re aiming for each session — leave anything blank to leave it unset.</p>
          <div className={styles.field} style={{ marginTop: 10 }}>
            <span className={styles.fieldLabel}>Duration (min)</span>
            <div className={styles.movePair} style={{ marginBottom: 6 }}>
              <button type="button" className={durMode === "single" ? styles.toggleActive : styles.toggleBtn} onClick={() => setDurMode("single")}>Single</button>
              <button type="button" className={durMode === "range" ? styles.toggleActive : styles.toggleBtn} onClick={() => setDurMode("range")}>Range</button>
            </div>
            {durMode === "single" ? (
              <div className={styles.fieldRow}>
                <NumField value={durSingle} onChange={setDurSingle} placeholder="30" />
              </div>
            ) : (
              <div className={styles.fieldRow}>
                <NumField value={durA} onChange={setDurA} placeholder="5" />
                <NumField value={durB} onChange={setDurB} placeholder="15" />
              </div>
            )}
          </div>
          <div className={styles.fieldRow} style={{ marginTop: 10 }}>
            <NumField label="Incline" value={incline} onChange={setIncline} placeholder="—" />
            <NumField label="Speed" value={speed} onChange={setSpeed} placeholder="—" allowDecimal />
          </div>
          <p className={styles.fieldNote} style={{ marginTop: 8 }}>
            This target lives on the exercise — it applies to <strong>{ex.exerciseName}</strong> everywhere it&rsquo;s used.
          </p>
          {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="submit" className={styles.primaryBtn} disabled={busy}>Save target</button>
          </div>
        </form>
      ) : (
        <form onSubmit={saveStrength}>
          <p className={styles.fieldNote}>What you&rsquo;re aiming for each session — leave anything blank to leave it unset.</p>
          <div className={styles.fieldRow} style={{ marginTop: 10 }}>
            <NumField label="Sets" value={targetSets} onChange={setTargetSets} placeholder="3" />
            <NumField label="Effort (RIR)" value={rirTarget} onChange={setRirTarget} placeholder="—" />
          </div>
          <div className={styles.field} style={{ marginTop: 10 }}>
            <span className={styles.fieldLabel}>Reps</span>
            <div style={{ marginBottom: 6 }}>{RepToggle}</div>
            {repMode === "single" ? (
              <div className={styles.fieldRow}>
                <NumField value={repSingle} onChange={setRepSingle} placeholder="10" />
              </div>
            ) : (
              <div className={styles.fieldRow}>
                <NumField value={repA} onChange={setRepA} placeholder="8" />
                <NumField value={repB} onChange={setRepB} placeholder="12" />
              </div>
            )}
          </div>
          {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="submit" className={styles.primaryBtn} disabled={busy}>Save target</button>
          </div>
        </form>
      )}

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
