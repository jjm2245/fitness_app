"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/session/Sheet";
import styles from "./editors.module.css";
import { api, type EditorExercise } from "./types";
import { CARDIO_FIELD_KEY, type CardioField } from "@/lib/cardioFields";
import { resolveLogFields, resolveMetricFields, routesToStrength } from "@/lib/logFields";
import { TARGET_EFFORT_OPTIONS, rirForEffortTarget, type EffortTag } from "@/lib/targetEffort";

// Exercise target edit sheet (v4). No target by default: the sheet shows an
// empty state until you opt in. Once opted in, ONE anchor is required (Sets for
// strength, Duration for cardio) — Save is disabled and the anchor errors until
// it's filled; everything else is optional. "Remove target" returns to no
// target. Invariant: stored rep/sets/duration values round-trip byte-identical
// ("8-12", single "10", Stairmaster [5,15]); a no-edit save re-writes the
// identical value (effort included, via the rir shim in targetEffort.ts).
// Cardio field-sets come from cardioFields() — unchanged, not re-hardcoded here.

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
  error,
}: {
  label?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowDecimal?: boolean;
  error?: boolean;
}) {
  return (
    <label className={styles.fieldHalf}>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      <input
        className={`${styles.fieldInput} ${error ? styles.inputErr : ""}`}
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
  const router = useRouter();
  // Phase 2: the CONFIG routes the sheet's branch (reps -> strength target on
  // program_exercises; else the metric target on exercises.params) — the same
  // rule as the session card router. conditioning_only no longer decides.
  const fieldSource = { name: ex.exerciseName, conditioningOnly: ex.conditioningOnly, logFields: ex.logFields };
  const isCardio = !routesToStrength(fieldSource);
  // Effort is a target field wherever the config includes it (metric branch).
  const metricHasEffort = resolveLogFields(fieldSource).includes("effort");
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
  // Effort adopts the session's 3-level scale. `effort_target` is the
  // authoritative tag; `rir_target` is kept in sync as its projection on save
  // (progression reads the number). Init from the native tag.
  // Metric branch reads its effort target from params (a tag string); the
  // strength branch keeps the native effort_target column.
  const [effort, setEffort] = useState<EffortTag | null>(
    isCardio
      ? ((((ex.params ?? {}) as Record<string, unknown>).effort as EffortTag | undefined) ?? null)
      : ex.effortTarget
  );

  // ── cardio state (edits the EXERCISE's params — applies everywhere) ──
  const cardioFieldSet = resolveMetricFields(fieldSource);
  const p = ex.params ?? {};
  const dur = p.duration_min;
  const durIsRange = Array.isArray(dur) && dur.length === 2;
  const [durMode, setDurMode] = useState<"single" | "range">(durIsRange ? "range" : "single");
  const [durSingle, setDurSingle] = useState(durIsRange ? "" : typeof dur === "number" ? String(dur) : "");
  const [durA, setDurA] = useState(durIsRange ? String((dur as number[])[0]) : "");
  const [durB, setDurB] = useState(durIsRange ? String((dur as number[])[1]) : "");
  const [incline, setIncline] = useState(typeof p.incline === "number" ? String(p.incline) : "");
  const [speed, setSpeed] = useState(typeof p.speed === "number" ? String(p.speed) : "");
  const [level, setLevel] = useState(typeof p.level === "number" ? String(p.level) : "");
  const [distance, setDistance] = useState(typeof p.distance === "number" ? String(p.distance) : "");

  type ExtraField = Exclude<CardioField, "duration">;
  const extraFieldState: Record<ExtraField, { value: string; set: (v: string) => void; label: React.ReactNode; decimal?: boolean }> = {
    speed: { value: speed, set: setSpeed, label: "Speed", decimal: true },
    incline: { value: incline, set: setIncline, label: "Incline" },
    level: { value: level, set: setLevel, label: "Level" },
    distance: { value: distance, set: setDistance, label: <>Distance (mi) <span className={styles.anchorReq}>*</span></>, decimal: true },
  };
  const extraFields = cardioFieldSet.filter((f): f is ExtraField => f !== "duration");

  // ── opt-in + anchor validity ──
  // A cardio target only counts as "set" when it has a Duration — incline/speed
  // alone is an invalid target (reads "Set a target").
  const durationComplete = durMode === "single" ? durSingle.trim() !== "" : durA.trim() !== "" && durB.trim() !== "";
  // Generalized anchor (Phase 2): reps configured -> Sets anchors (strength
  // branch, unchanged). Otherwise at least ONE of duration or distance
  // satisfies it — either alone, or both as a compound target.
  const distanceComplete = cardioFieldSet.includes("distance") && distance.trim() !== "";
  const metricAnchor = durationComplete || distanceComplete;
  const initialOpted = isCardio ? metricAnchor : ex.targetSets != null;
  const [opted, setOpted] = useState(initialOpted);

  const setsComplete = targetSets.trim() !== "";
  const anchorValid = isCardio ? metricAnchor : setsComplete;

  function repRangeToStore(): string | null {
    if (repMode === "single") return repSingle.trim() === "" ? null : repSingle.trim();
    const a = repA.trim(), b = repB.trim();
    if (a !== "" && b !== "") return `${a}-${b}`;
    return a || b || null; // an incomplete range degrades to the one value / unset
  }

  async function saveStrength(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !anchorValid) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/program-exercises/${ex.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          targetSets: Number(targetSets),
          repRange: repRangeToStore(),
          effortTarget: effort,
          rirTarget: rirForEffortTarget(effort, ex.effortTarget, ex.rirTarget ?? null),
        }),
      });
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't save — try again.");
      setBusy(false);
    }
  }

  function buildCardioParams(): Record<string, unknown> {
    // Merge over existing params so keys this exercise doesn't show are PRESERVED
    // (e.g. a stored incline on a stair machine whose field-set is duration+level).
    const params: Record<string, unknown> = { ...(ex.params ?? {}) };
    if (durMode === "single") {
      if (durSingle.trim() !== "") params.duration_min = Number(durSingle);
      else delete params.duration_min;
    } else if (durA.trim() !== "" && durB.trim() !== "") {
      params.duration_min = [Number(durA), Number(durB)];
    } else {
      delete params.duration_min;
    }
    for (const f of extraFields) {
      const key = CARDIO_FIELD_KEY[f];
      const raw = extraFieldState[f].value;
      if (raw.trim() !== "") params[key] = Number(raw);
      else delete params[key];
    }
    // Effort target for a metric exercise lives in params (a tag string, the
    // same enum values as everywhere) — only when the config includes effort.
    if (metricHasEffort) {
      if (effort) params.effort = effort;
      else delete params.effort;
    }
    return params;
  }

  async function saveCardio(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !anchorValid) return;
    setBusy(true);
    setErr(null);
    const params = buildCardioParams();
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

  // "Remove target" → back to no target. If nothing was ever stored (added but
  // not saved), just collapse to the empty state; otherwise persist the clear.
  async function removeTarget() {
    if (!initialOpted) { setOpted(false); return; }
    setBusy(true);
    setErr(null);
    try {
      if (isCardio) {
        const params: Record<string, unknown> = { ...(ex.params ?? {}) };
        delete params.duration_min;
        delete params.effort;
        for (const f of extraFields) delete params[CARDIO_FIELD_KEY[f]];
        await api(`/api/exercises/${encodeURIComponent(ex.exerciseId)}`, {
          method: "PATCH",
          body: JSON.stringify({ params: Object.keys(params).length ? params : null }),
        });
      } else {
        await api(`/api/program-exercises/${ex.id}`, {
          method: "PATCH",
          body: JSON.stringify({ targetSets: null, repRange: null, effortTarget: null, rirTarget: null }),
        });
      }
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't remove the target — try again.");
      setBusy(false);
    }
  }

  // Remove the whole EXERCISE from this day/list (distinct from removing its target).
  async function removeExercise() {
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

  const SegToggle = ({ mode, onSet }: { mode: "single" | "range"; onSet: (m: "single" | "range") => void }) => (
    <div className={styles.segToggle}>
      <button type="button" className={mode === "single" ? styles.segActive : styles.segBtn} onClick={() => onSet("single")}>Single</button>
      <button type="button" className={mode === "range" ? styles.segActive : styles.segBtn} onClick={() => onSet("range")}>Range</button>
    </div>
  );

  const EffortPills = (
    <div className={styles.field} style={{ marginTop: 12 }}>
      <span className={styles.fieldLabel}>Effort</span>
      <div className={styles.pillRow}>
        {TARGET_EFFORT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={effort === o.value ? styles.pillActive : styles.pill}
            onClick={() => setEffort((cur) => (cur === o.value ? null : o.value))}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  const anchorError = opted && !anchorValid;

  return (
    <Sheet title={ex.exerciseName} onClose={onClose}>
      <div className={styles.sectionLabel}>Target</div>

      {!opted ? (
        <div className={styles.emptyTarget}>
          <span className={styles.emptyTargetNote}>No target set for this exercise.</span>
          <button type="button" className={styles.addTargetBtn} onClick={() => setOpted(true)}>＋ Add a target</button>
        </div>
      ) : isCardio ? (
        <form onSubmit={saveCardio}>
          {cardioFieldSet.includes("duration") && (
            <div className={styles.field}>
              <div className={styles.repsHead}>
                <span className={styles.fieldLabel}>Duration (min) <span className={styles.anchorReq}>*</span></span>
                <SegToggle mode={durMode} onSet={setDurMode} />
              </div>
              {durMode === "single" ? (
                <div className={styles.fieldRow}>
                  <NumField value={durSingle} onChange={setDurSingle} placeholder="30" error={anchorError} />
                </div>
              ) : (
                <div className={styles.fieldRow}>
                  <NumField value={durA} onChange={setDurA} placeholder="5" error={anchorError} />
                  <NumField value={durB} onChange={setDurB} placeholder="15" error={anchorError} />
                </div>
              )}
            </div>
          )}
          {extraFields.length > 0 && (
            <div className={styles.fieldRow} style={{ marginTop: 10 }}>
              {extraFields.map((f) => {
                const c = extraFieldState[f];
                return <NumField key={f} label={c.label} value={c.value} onChange={c.set} placeholder="—" allowDecimal={c.decimal} error={f === "distance" && anchorError} />;
              })}
            </div>
          )}
          {metricHasEffort && EffortPills}
          {anchorError && <p className={styles.errText} style={{ marginTop: 8 }}>Add a duration or distance to save this target.</p>}
          <p className={styles.fieldNote} style={{ marginTop: 8 }}>
            Lives on the exercise — applies to <strong>{ex.exerciseName}</strong> everywhere it&rsquo;s used.
          </p>
          {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="submit" className={styles.primaryBtn} disabled={busy || !anchorValid}>Save target</button>
          </div>
          <button type="button" className={styles.linkRemove} style={{ marginTop: 10 }} onClick={removeTarget} disabled={busy}>Remove target</button>
        </form>
      ) : (
        <form onSubmit={saveStrength}>
          {/* Sets + Reps share ONE row of evenly-sized boxes: Sets is always one
              box (= a rep box); Reps is one box (Single) or two (Range). The
              label/toggle head aligns above the boxes; the toggle sits beside the
              Reps label so it never widens Sets or breaks the row. */}
          <div className={styles.srHead}>
            <span className={`${styles.fieldLabel} ${styles.srHeadSets}`}>Sets <span className={styles.anchorReq}>*</span></span>
            <div className={`${styles.srHeadReps} ${repMode === "range" ? styles.srHeadRepsWide : ""}`}>
              <span className={styles.fieldLabel}>Reps</span>
              <SegToggle mode={repMode} onSet={setRepMode} />
            </div>
          </div>
          <div className={styles.srBoxes}>
            <NumField value={targetSets} onChange={setTargetSets} placeholder="3" error={anchorError} />
            {repMode === "single" ? (
              <NumField value={repSingle} onChange={setRepSingle} placeholder="10" />
            ) : (
              <>
                <NumField value={repA} onChange={setRepA} placeholder="8" />
                <NumField value={repB} onChange={setRepB} placeholder="12" />
              </>
            )}
          </div>
          {EffortPills}
          {anchorError && <p className={styles.errText} style={{ marginTop: 8 }}>Add sets to save this target.</p>}
          {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="submit" className={styles.primaryBtn} disabled={busy || !anchorValid}>Save target</button>
          </div>
          <button type="button" className={styles.linkRemove} style={{ marginTop: 10 }} onClick={removeTarget} disabled={busy}>Remove target</button>
        </form>
      )}

      {/* Quiet nav to the full exercise editor — for everything the target
          inputs don't cover (rename, type, tag, equipment). Works for
          library-sourced exercises too (the manage list now includes them). */}
      <button
        type="button"
        className={styles.linkRemove}
        style={{ marginTop: 14 }}
        onClick={() => { onClose(); router.push(`/exercises?edit=${encodeURIComponent(ex.exerciseId)}`); }}
      >
        Edit exercise →
      </button>

      <div className={styles.sectionLabel}>Remove</div>
      {confirmRemove ? (
        <div className={styles.sheetActions}>
          <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={removeExercise} disabled={busy}>
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
