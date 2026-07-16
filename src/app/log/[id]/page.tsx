"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import styles from "../log.module.css";
import { ExerciseSearch, ProvenanceBadge, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import { prettyDayName } from "@/lib/labels";
import { EQUIPMENT_TYPES, EQUIPMENT_TYPE_BY_ID, laneKey, suggestEquipmentType, type EquipmentTypeId } from "@/lib/equipment";
import {
  logSet,
  editSet,
  deleteSet,
  getSessionSets,
  getCompletedInstances,
  setOccurrenceCompleted,
  getSession,
  hydrateFromServer,
  finishSession,
  editSessionMeta,
  sync,
  pendingCount,
  addOccurrence,
  listOccurrences,
  moveOccurrence,
  removeOccurrence,
  logCardio,
  getSessionCardio,
  deleteCardio,
  type LocalSession,
  type SessionSet,
  type SessionCardio,
  type Occurrence,
  type AttachExercise,
  type SetSide,
} from "@/lib/sessionStore";

interface ProgramExerciseDetail {
  id: number;
  exerciseId: string;
  targetSets: number;
  repRange: string | null;
  rirTarget: string | null;
  orderIndex: number;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  params: Record<string, unknown> | null;
  source: string;
  untagged: boolean;
  unilateral?: boolean;
}
interface ProgramDayDetail {
  id: number;
  name: string;
  orderIndex: number;
  exercises: ProgramExerciseDetail[];
}
interface ProgramDetail {
  id: number;
  splitType: string;
  days: ProgramDayDetail[];
}
interface EquipmentOption {
  id: string; // opaque stable key (surrogate-key model)
  label: string; // display name
  builtInWeight: string | null; // auto-applied additive offset when selected
  notes: string | null;
}
interface BlockDetail {
  id: number;
  name: string;
  exercises: ProgramExerciseDetail[];
}
interface SubstitutionCandidate {
  id: string;
  name: string;
  score: number;
  loadType: string;
  portable: boolean;
  unilateral?: boolean;
}

type ProgressionResult =
  | { status: "new_machine_baseline"; reason: string }
  | {
      status: "resolved";
      signal:
        | { type: "insufficient_data" }
        | { type: "increase_load"; reason: string; suggestedLoad?: number }
        | { type: "progressing"; reason: string }
        | { type: "true_stall"; reason: string }
        | { type: "regression"; reason: string }
        | { type: "hold"; reason: string };
      intervention?: { id: string; message: string };
    };

// A card = one performed occurrence (v2). Ordered; repeats produce multiple
// cards for the same exercise, each with its own instanceId + sets.
interface LoggableOccurrence {
  instanceId: string;
  orderIndex: number;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  target: { targetSets: number; repRange: string | null; rirTarget: string | null } | null;
  params: Record<string, unknown> | null;
  source: string;
  provenance: string;
  untagged: boolean;
  unilateral: boolean;
}

function parseRepRangeMax(repRange: string | null): number {
  if (!repRange) return 12;
  const parts = repRange.split("-");
  const max = Number(parts[parts.length - 1]);
  return Number.isFinite(max) ? max : 12;
}
function lastEquipmentKey(exerciseId: string) {
  return `fitness-app:last-machine:${exerciseId}`;
}
function lastTypeKey(exerciseId: string) {
  return `fitness-app:last-equiptype:${exerciseId}`;
}
// One-time offset confirmation per (exercise, type): a keyword/type default may
// PRE-SELECT a non-zero offset but must never silently apply it — wrong-toward-
// zero costs nothing, wrong-toward-45 corrupts every set. Confirmed once,
// remembered here. (Named units' stored offsets are explicit → no prompt.)
function offsetOkKey(exerciseId: string, type: string) {
  return `fitness-app:offset-ok:${exerciseId}:${type}`;
}
// The neutral default: "I'm using a machine but haven't said which" — distinct
// from "No machine" (which asserts free/portable). Both resolve to a null
// equipmentId (the portable/free progression lane), so this is a labelling choice
// only and never splits an exercise's history — the core is untouched. A sentinel
// (not "") so we can tell it apart from an explicit "No machine" in the UI.
const UNSPECIFIED_UNIT = "__unspecified__";
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

type CardioField = "duration" | "speed" | "incline" | "level" | "distance";
function cardioFields(name: string): CardioField[] {
  const n = name.toLowerCase();
  if (n.includes("treadmill") || n.includes("incline walk") || n.includes("run")) {
    return ["duration", "speed", "incline"];
  }
  if (n.includes("stair") || n.includes("step")) return ["duration", "level"];
  if (n.includes("bike") || n.includes("cycl") || n.includes("spin")) return ["duration", "level", "distance"];
  if (n.includes("row")) return ["duration", "distance", "level"];
  return ["duration", "distance"];
}

type EffortTag = "more_in_me" | "near_failure" | "to_failure";
const EFFORT_OPTIONS: { value: EffortTag; label: string }[] = [
  { value: "more_in_me", label: "More in me" },
  { value: "near_failure", label: "Near failure" },
  { value: "to_failure", label: "To failure" },
];
const EFFORT_LABEL: Record<EffortTag, string> = {
  more_in_me: "more in me",
  near_failure: "near failure",
  to_failure: "to failure",
};

function EffortPicker({ value, onChange }: { value: EffortTag | null; onChange: (v: EffortTag) => void }) {
  return (
    <span className={styles.effortPicker}>
      {EFFORT_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={value === o.value ? styles.effortActive : styles.effortBtn}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

function fmtRest(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
// Digits-only mm:ss mask (2c): the user types digits, the colon is ours.
// "145" reads as 1:45 (fill from the right); seconds clamp to :59; bounded to
// [0:00, 59:59] so a fat-finger can't record an hour-long rest.
function digitsToSeconds(digits: string): number {
  const d = digits.replace(/\D/g, "").slice(-4);
  if (!d) return 0;
  const secs = Math.min(59, Number(d.slice(-2)));
  const mins = Math.min(59, Number(d.slice(0, -2) || "0"));
  return mins * 60 + secs;
}

// The rest chip: shows the value with its honesty tag (est/timed/you/unknown) and
// is tappable to correct — a corrected value becomes source "user".
function RestChip({ set, onChanged }: { set: SessionSet; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [digits, setDigits] = useState(""); // raw digit buffer; the mask formats it
  const label =
    set.restSeconds != null
      ? set.restSource === "derived"
        ? `rest ~${fmtRest(set.restSeconds)} · est`
        : set.restSource === "timed"
        ? `rest ${fmtRest(set.restSeconds)} · timed`
        : `rest ${fmtRest(set.restSeconds)}`
      : "rest —";

  async function save() {
    if (!digits) return setEditing(false);
    await editSet(set.localId!, { restSeconds: digitsToSeconds(digits), restSource: "user" });
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <input
          value={digits ? fmtRest(digitsToSeconds(digits)) : ""}
          onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(-4))}
          inputMode="numeric"
          placeholder="m:ss"
          autoFocus
          style={{ width: 52, fontSize: 12 }}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        />
        <button type="button" onClick={save} className={styles.secondaryBtn}>✓</button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.restChip}
      title={set.restSeconds == null ? "Rest unknown — tap to set" : "Tap to correct the rest"}
      onClick={() => { setDigits(set.restSeconds != null ? String(Math.floor(set.restSeconds / 60)) + String(set.restSeconds % 60).padStart(2, "0") : ""); setEditing(true); }}
    >
      {label}
    </button>
  );
}

// Tap the session's date to correct it — a morning-after log or a corrupted
// stamp gets the TRUE date/time from the only honest source: the user. Saved
// with firstFinishedSource 'user' (traceable input, like a corrected rest);
// blank time = honest blank (no fabricated value). Fully offline: the edit is
// pending (metaDirty) until the PATCH drains.
function SessionDateEditor({ session, onChanged }: { session: LocalSession; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [dateVal, setDateVal] = useState(session.date);
  const [timeVal, setTimeVal] = useState("");

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

  const timeLabel = session.firstFinishedAt
    ? ` · ${new Date(session.firstFinishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";
  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        className={styles.secondaryBtn}
        style={{ fontWeight: 400, fontSize: 15 }}
        title={`Tap to correct this session's date/time${session.firstFinishedSource === "user" ? " — currently set by you" : ""}`}
      >
        {session.date}{timeLabel}{session.firstFinishedSource === "user" ? " · set by you" : ""} ✎
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 14, fontWeight: 400 }}>
      <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
      <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} title="Optional — leave blank for no time" />
      <button type="button" onClick={save} className={styles.primary}>Save</button>
      <button type="button" onClick={() => setEditing(false)} className={styles.secondaryBtn}>Cancel</button>
    </span>
  );
}

function LoggedSetRow({ set, isDrop, showRest, unilateral, onChanged, onDrop }: { set: SessionSet; isDrop: boolean; showRest: boolean; unilateral: boolean; onChanged: () => void; onDrop: (parent: SessionSet) => void }) {
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
      <li style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "3px 0", fontSize: 14, paddingLeft: isDrop ? 22 : 0 }}>
        <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 56 }} />
        <span>×</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 44 }} />
        <EffortPicker value={effort} onChange={setEffort} />
        {(unilateral || set.side != null) && (
          // The condition is "the EXERCISE is unilateral" — not "the set already
          // has a side" — so a historical set logged before the tag existed can
          // have its side ADDED here, not just flipped.
          <span className={styles.effortPicker}>
            {(["left", "right", "both"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} className={side === s ? styles.effortActive : styles.effortBtn}>
                {s === "left" ? "L" : s === "right" ? "R" : "Alternating"}
              </button>
            ))}
          </span>
        )}
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </li>
    );
  }
  const sideTag = set.side === "left" ? " · L" : set.side === "right" ? " · R" : set.side === "both" ? " · Alternating" : "";
  // Transparent load math when a built-in offset applied: "90 + 20 = 110 lb".
  const loadText =
    set.builtinOffset != null && set.builtinOffset !== 0 && set.loadEntered != null
      ? `${set.loadEntered} + ${set.builtinOffset} = ${set.load} lb`
      : `${set.load} lb`;
  return (
    <li className={styles.loggedRow} style={isDrop ? { paddingLeft: 22, borderLeft: "2px solid var(--accent, #6ea8fe)", marginLeft: 8 } : undefined}>
      <span className={pending ? styles.pending : styles.synced} title={pending ? "Not yet synced" : "Synced"}>
        {pending ? "○" : "✓"}
      </span>
      <span>
        {isDrop ? "↳ drop: " : `${set.setType === "warmup" ? "Warm-up" : "Working"}: `}
        {loadText} × {set.reps}
        {set.effort ? ` · ${EFFORT_LABEL[set.effort]}` : ""}
        {sideTag}
      </span>
      {showRest && <RestChip set={set} onChanged={onChanged} />}
      <button type="button" onClick={() => setEditing(true)} className={styles.secondaryBtn}>Edit</button>
      <button type="button" onClick={remove} className={styles.secondaryBtn}>Delete</button>
      <button type="button" onClick={() => onDrop(set)} className={styles.secondaryBtn} title="Add a drop-set segment under this set">+ Drop</button>
    </li>
  );
}

// Add-equipment modal (3d): full unit fields captured mid-session without
// leaving the log. The entered offset becomes the unit's stored default.
function AddUnitModal({ exerciseId, presetType, onClose, onCreated }: {
  exerciseId: string;
  presetType: EquipmentTypeId;
  onClose: () => void;
  onCreated: (unit: EquipmentOption) => void;
}) {
  const [label, setLabel] = useState("");
  const [gym, setGym] = useState("");
  const [brand, setBrand] = useState("");
  const [offset, setOffset] = useState("");
  const [ratio, setRatio] = useState("unknown");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!label.trim() || busy) return;
    setBusy(true);
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `u_${Date.now().toString(36)}`;
    const unit: EquipmentOption = { id, label: label.trim(), builtInWeight: offset.trim() !== "" ? offset.trim() : null, notes: notes.trim() || null };
    try {
      await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id, label: label.trim(), equipmentType: presetType, gym: gym.trim() || null, brand: brand.trim() || null,
          builtInWeight: offset.trim() !== "" ? Number(offset) : null, pulleyRatioKind: ratio, notes: notes.trim() || null,
        }),
      });
    } catch {
      /* offline — the next set's sync auto-registers id+label+type+offset */
    }
    setBusy(false);
    onCreated(unit); // optimistic: selected immediately, offline included
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--bg, #111)", border: "1px solid var(--border, #444)", borderRadius: 10, padding: 16, width: "min(420px, 92vw)", display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <strong>New {EQUIPMENT_TYPE_BY_ID.get(presetType)?.label.toLowerCase()} unit</strong>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='label, e.g. "leg ext by the mirror"' autoFocus style={{ minWidth: 0, width: "100%", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
          <input value={gym} onChange={(e) => setGym(e.target.value)} placeholder="gym / location" style={{ flex: 1, minWidth: 0 }} />
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="manufacturer" style={{ flex: 1, minWidth: 0 }} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
          <label>built-in lb{" "}
            <input type="number" value={offset} onChange={(e) => setOffset(e.target.value)} placeholder={EQUIPMENT_TYPE_BY_ID.get(presetType)?.defaultOffset == null ? "?" : String(EQUIPMENT_TYPE_BY_ID.get(presetType)?.defaultOffset)} style={{ width: 64 }} />
          </label>
          <label>pulley{" "}
            <select value={ratio} onChange={(e) => setRatio(e.target.value)} title="Captured for interpretation only — a ratio cancels out of every lane-scoped comparison, so it is NEVER folded into the logged load.">
              <option value="unknown">unknown</option>
              <option value="1:1">1:1</option>
              <option value="2:1">2:1</option>
              <option value="other">other</option>
            </select>
          </label>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="description — quirks, cam feel, serial…" rows={2} style={{ resize: "vertical", fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className={styles.secondaryBtn}>Cancel</button>
          <button type="button" onClick={create} disabled={busy || !label.trim()} className={styles.primary}>Add unit</button>
        </div>
      </div>
    </div>
  );
}

interface CardControls {
  position: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function ReorderControls({ position, total, onMoveUp, onMoveDown, onRemove }: CardControls) {
  return (
    <span className={styles.reorder}>
      <button type="button" className={styles.iconBtn} onClick={onMoveUp} disabled={position === 0} title="Move up" aria-label="Move up">↑</button>
      <button type="button" className={styles.iconBtn} onClick={onMoveDown} disabled={position === total - 1} title="Move down" aria-label="Move down">↓</button>
      <button type="button" className={styles.iconBtn} onClick={onRemove} title="Remove from session" aria-label="Remove">✕</button>
    </span>
  );
}

function StrengthCard({
  ex,
  sessionId,
  date,
  controls,
  sessionSets,
  completed,
  onSessionChanged,
  onToggleComplete,
}: {
  ex: LoggableOccurrence;
  sessionId: string;
  date: string;
  controls: CardControls;
  sessionSets: SessionSet[];
  completed: boolean;
  onSessionChanged: () => void;
  onToggleComplete: (instanceId: string, completed: boolean) => void;
}) {
  const [activeExercise, setActiveExercise] = useState({
    id: ex.exerciseId,
    name: ex.exerciseName,
    loadType: ex.loadType,
    portable: ex.portable,
    unilateral: ex.unilateral,
  });
  // Machines curated for THIS exercise (Part 3c), not the global list.
  const [equipmentUnits, setEquipmentUnits] = useState<EquipmentOption[]>([]);
  const refreshEquipmentUnits = useCallback(async () => {
    const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/equipment`);
    if (res.ok) setEquipmentUnits(await res.json());
  }, [activeExercise.id]);
  const [equipmentId, setEquipmentId] = useState(() => {
    // Default to "Unspecified machine" unless a named machine was last used here.
    if (typeof window === "undefined") return UNSPECIFIED_UNIT;
    return localStorage.getItem(lastEquipmentKey(ex.exerciseId)) ?? UNSPECIFIED_UNIT;
  });
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  const [load, setLoad] = useState(ex.loadType === "bodyweight" ? 0 : 45);
  const [reps, setReps] = useState(8);
  const [effort, setEffort] = useState<EffortTag | null>(null);
  // Unilateral side (Part 4): recorded per set; auto-alternates L→R after
  // logging (tap to override; "both" stays put).
  const [side, setSide] = useState<SetSide>("left");
  // Set-level rest timer (2b): lives with THIS exercise's sets. Tap-to-start
  // after racking; stopping (or hitting the target) HOLDS the elapsed value,
  // which is auto-written as the NEXT set's restBefore (source "timed") — the
  // timer does the logging, not the user. Pure client state, offline-fine.
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [heldRest, setHeldRest] = useState<number | null>(null);
  const [timerTargetMin, setTimerTargetMin] = useState("");
  // Display mirror of the running elapsed seconds (render never reads the clock).
  const [timerElapsed, setTimerElapsed] = useState(0);
  const timerNotified = useRef(false);
  useEffect(() => {
    if (timerStart == null) return;
    const iv = setInterval(() => {
      setTimerElapsed(Math.floor((Date.now() - timerStart) / 1000));
      const mins = Number(timerTargetMin);
      if (Number.isFinite(mins) && mins > 0 && Date.now() - timerStart >= mins * 60_000) {
        // Target hit: hold the rest at the target and notify — it will be
        // written to the next set automatically.
        setHeldRest(Math.round((Date.now() - timerStart) / 1000));
        setTimerStart(null);
        if (!timerNotified.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
          timerNotified.current = true;
          new Notification("Rest done — next set");
        }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [timerStart, timerTargetMin]);
  function takeTimedRest(): number | null {
    if (heldRest != null) {
      const v = heldRest;
      setHeldRest(null);
      return v;
    }
    if (timerStart != null) {
      const v = (Date.now() - timerStart) / 1000;
      setTimerStart(null);
      return v;
    }
    return null;
  }
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });

  // Equipment model (Part 3): the TYPE is always a real answer (always shown,
  // pre-selected from the exercise, editable); WHICH UNIT exists only for
  // context-bound types. "No machine"/"Unspecified machine" are gone as
  // top-level options — unspecified is a unit-level state of a context-bound
  // type, with its own lane (never the portable lane).
  const [equipType, setEquipType] = useState<EquipmentTypeId>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(lastTypeKey(ex.exerciseId));
      if (stored && EQUIPMENT_TYPE_BY_ID.has(stored as EquipmentTypeId)) return stored as EquipmentTypeId;
    }
    return suggestEquipmentType(ex.loadType, ex.exerciseName);
  });
  const typeDef = EQUIPMENT_TYPE_BY_ID.get(equipType)!;
  const contextBound = typeDef.instanceMatters;
  const resolvedUnitId = contextBound && equipmentId !== "" && equipmentId !== UNSPECIFIED_UNIT ? equipmentId : null;
  const selectedUnit = resolvedUnitId ? equipmentUnits.find((m) => m.id === resolvedUnitId) ?? null : null;
  const lane = laneKey(equipType, resolvedUnitId);

  // Offset (3a/3b): a named unit's stored offset pre-fills (explicit → no
  // prompt); otherwise the type default. Editable per set — the edit is a
  // set-level override, never a rewrite of the unit's default. Non-zero
  // TYPE-LEVEL defaults are UNCONFIRMED until once-confirmed per exercise
  // (effOffset stays 0 until then). plate_loaded default is unknown (null):
  // prompted, never guessed.
  const defaultOffset = selectedUnit?.builtInWeight != null ? Number(selectedUnit.builtInWeight) : typeDef.defaultOffset;
  const [offsetInput, setOffsetInput] = useState<string>(defaultOffset != null ? String(defaultOffset) : "");
  const [offsetConfirmed, setOffsetConfirmed] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem(offsetOkKey(ex.exerciseId, equipType)) != null
  );
  useEffect(() => {
    // Re-derive the pre-fill + confirmation whenever the type or unit changes.
    (async () => {
      setOffsetInput(defaultOffset != null ? String(defaultOffset) : "");
      setOffsetConfirmed(localStorage.getItem(offsetOkKey(activeExercise.id, equipType)) != null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipType, resolvedUnitId, activeExercise.id]);
  const offsetRelevant =
    typeDef.defaultOffset !== 0 || (selectedUnit?.builtInWeight != null && Number(selectedUnit.builtInWeight) !== 0);
  const offsetNum = offsetInput.trim() !== "" && Number.isFinite(Number(offsetInput)) ? Number(offsetInput) : 0;
  // Needs a one-tap confirmation: non-zero type-level default, not yet confirmed
  // for this exercise, and no explicit unit-stored offset backing it.
  const offsetNeedsConfirm = offsetRelevant && offsetNum !== 0 && !offsetConfirmed && selectedUnit?.builtInWeight == null;
  const effOffset = !offsetRelevant ? 0 : offsetNeedsConfirm ? 0 : offsetNum;
  const totalLoad = load + effOffset;
  function confirmOffset(value: number) {
    localStorage.setItem(offsetOkKey(activeExercise.id, equipType), String(value));
    setOffsetConfirmed(true);
  }
  function pickType(t: EquipmentTypeId) {
    setEquipType(t);
    localStorage.setItem(lastTypeKey(activeExercise.id), t);
    setEquipmentId(UNSPECIFIED_UNIT); // unit selection resets with the type
  }
  // Sets for THIS occurrence only (repeats keep separate set lists).
  const loggedSets = sessionSets.filter((s) => s.instanceId === ex.instanceId);

  // Load this exercise's curated unit list (always — the field is always on).
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/equipment`);
      if (res.ok) setEquipmentUnits(await res.json());
    })();
  }, [activeExercise.id]);

  // Refresh flags that may have changed since this occurrence was snapshotted —
  // tagging an exercise unilateral must make its HISTORICAL sets side-editable
  // too, not just future ones. Offline: the snapshot stands.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}`);
        if (res.ok) {
          const meta: { unilateral?: boolean } = await res.json();
          if (typeof meta.unilateral === "boolean") {
            setActiveExercise((a) => (a.unilateral === meta.unilateral ? a : { ...a, unilateral: meta.unilateral! }));
          }
        }
      } catch {
        /* offline — occurrence snapshot stands */
      }
    })();
  }, [activeExercise.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (lane) params.set("lane", lane);
      const res = await fetch(`/api/exercises/${activeExercise.id}/last-session?${params.toString()}`);
      const data: { session: { sets: Array<{ load: number; reps: number }> } | null } = await res.json();
      if (cancelled) return;
      if (data.session) {
        const reps = data.session.sets.map((s) => s.reps).join(", ");
        setPrevious(`Last time: ${data.session.sets[0]?.load ?? "?"} × ${reps}`);
      } else if (lane) {
        // Recalibrate, don't reset (3e): no history in THIS lane, but show
        // continuity from the exercise's other lanes — effort + volume carry
        // over; switching units is never "starting over".
        const any = await fetch(`/api/exercises/${activeExercise.id}/last-session`);
        const anyData: { session: { sets: Array<{ load: number; reps: number }> } | null } = await any.json();
        if (cancelled) return;
        if (anyData.session) {
          setPrevious(`Recalibrating for this unit — you were at ${anyData.session.sets[0]?.load ?? "?"} on another unit (effort + volume carry over)`);
        } else {
          setPrevious("No previous session yet");
        }
      } else {
        setPrevious("No previous session yet");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeExercise.id, lane]);

  const checkProgression = useCallback(async () => {
    setChecking(true);
    try {
      const params = new URLSearchParams({
        exerciseId: activeExercise.id,
        repRangeMax: String(parseRepRangeMax(ex.target?.repRange ?? null)),
        targetRir: String(ex.target?.rirTarget ?? 2),
      });
      if (lane) params.set("lane", lane);
      const res = await fetch(`/api/progression?${params.toString()}`);
      setProgression(await res.json());
    } finally {
      setChecking(false);
    }
  }, [activeExercise.id, ex.target, lane]);

  async function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(reps) || reps < 1) return setError("Reps must be at least 1.");
    if (!Number.isFinite(load) || load < 0) return setError("Load can't be negative.");
    setError(null);
    await logSet({
      sessionId,
      instanceId: ex.instanceId,
      date,
      exerciseId: activeExercise.id,
      exerciseName: activeExercise.name,
      equipmentId: resolvedUnitId,
      equipmentLabel: selectedUnit?.label ?? null,
      equipmentType: equipType,
      equipmentBuiltInWeight: selectedUnit?.builtInWeight != null ? Number(selectedUnit.builtInWeight) : null,
      setType,
      // Effective load = entered + known offset; the components are stored too,
      // so the math stays visible ("90 + 20 = 110") and the core reads the total.
      load: totalLoad,
      loadEntered: effOffset !== 0 ? load : null,
      builtinOffset: effOffset !== 0 ? effOffset : null,
      reps,
      effort,
      rir: null,
      side: activeExercise.unilateral ? side : null,
      // If the rest timer is running, this set consumes it as an exact rest.
      timedRestSeconds: takeTimedRest(),
    });
    if (resolvedUnitId) localStorage.setItem(lastEquipmentKey(activeExercise.id), resolvedUnitId);
    // Auto-alternate for the next side-set (L→R→L…); "both" stays put.
    if (activeExercise.unilateral && side !== "both") setSide(side === "left" ? "right" : "left");
    onSessionChanged();
  }

  // Drop sets ("+ Drop"): a drop segment is its own set row, linked to its parent
  // by dropGroupId, sharing the parent's set number + occurrence. Explicit — no
  // conventions to remember; the group renders as one nested unit.
  const [dropFor, setDropFor] = useState<SessionSet | null>(null);
  const [dropLoad, setDropLoad] = useState("");
  const [dropReps, setDropReps] = useState(8);
  async function startDrop(parent: SessionSet) {
    let groupId = parent.dropGroupId ?? null;
    if (!groupId) {
      groupId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `g_${Date.now().toString(36)}`;
      await editSet(parent.localId!, { dropGroupId: groupId }); // pending_update if synced
      onSessionChanged();
    }
    setDropFor({ ...parent, dropGroupId: groupId });
    setDropLoad(""); // weight deliberately blank — you just stripped it
    setDropReps(parent.reps);
  }
  async function addDrop(e: React.FormEvent) {
    e.preventDefault();
    if (!dropFor) return;
    const l = Number(dropLoad);
    if (!Number.isFinite(l) || l < 0) return setError("Drop load can't be negative.");
    if (!Number.isFinite(dropReps) || dropReps < 1) return setError("Reps must be at least 1.");
    setError(null);
    await logSet({
      sessionId,
      instanceId: dropFor.instanceId, // drops inherit the parent's occurrence
      date,
      exerciseId: dropFor.exerciseId,
      exerciseName: dropFor.exerciseName,
      equipmentId: dropFor.equipmentId,
      equipmentLabel: dropFor.equipmentLabel ?? null,
      setType: dropFor.setType,
      load: l,
      reps: dropReps,
      effort: null,
      rir: null,
      dropGroupId: dropFor.dropGroupId,
      parentSetIndex: dropFor.setIndex,
      side: dropFor.side ?? null, // a drop continues the same side
    });
    setDropFor(null);
    onSessionChanged();
  }

  // Render order: keep log order, but pull each drop group together — parent
  // first (earliest row), its drops nested under it.
  const displaySets = useMemo(() => {
    const out: Array<{ set: SessionSet; isDrop: boolean }> = [];
    const emitted = new Set<number>();
    for (const s of loggedSets) {
      if (emitted.has(s.localId!)) continue;
      if (!s.dropGroupId) {
        out.push({ set: s, isDrop: false });
        emitted.add(s.localId!);
        continue;
      }
      const group = loggedSets.filter((g) => g.dropGroupId === s.dropGroupId);
      group.forEach((g, i) => {
        out.push({ set: g, isDrop: i > 0 });
        emitted.add(g.localId!);
      });
    }
    return out;
  }, [loggedSets]);

  async function openSwap() {
    setSwapOpen((o) => !o);
    if (swapCandidates) return;
    const res = await fetch(`/api/substitutions?exerciseId=${encodeURIComponent(ex.exerciseId)}`);
    setSwapCandidates(await res.json());
  }
  function pickSwap(c: SubstitutionCandidate) {
    setActiveExercise({ id: c.id, name: c.name, loadType: c.loadType, portable: c.portable, unilateral: c.unilateral ?? false });
    setEquipmentId(localStorage.getItem(lastEquipmentKey(c.id)) ?? UNSPECIFIED_UNIT);
    const storedT = localStorage.getItem(lastTypeKey(c.id));
    setEquipType(storedT && EQUIPMENT_TYPE_BY_ID.has(storedT as EquipmentTypeId) ? (storedT as EquipmentTypeId) : suggestEquipmentType(c.loadType, c.name));
    setSwapOpen(false);
  }
  function resetSwap() {
    setActiveExercise({ id: ex.exerciseId, name: ex.exerciseName, loadType: ex.loadType, portable: ex.portable, unilateral: ex.unilateral });
    setEquipmentId(localStorage.getItem(lastEquipmentKey(ex.exerciseId)) ?? UNSPECIFIED_UNIT);
    const storedT = localStorage.getItem(lastTypeKey(ex.exerciseId));
    setEquipType(storedT && EQUIPMENT_TYPE_BY_ID.has(storedT as EquipmentTypeId) ? (storedT as EquipmentTypeId) : suggestEquipmentType(ex.loadType, ex.exerciseName));
    setSwapOpen(false);
  }
  // Session-level relabel (3e): naming a unit mid-session reassigns THIS
  // session's sets that sat in the type's unspecified lane. Local edit +
  // pending_update; prior sessions are never touched.
  async function relabelSessionSets(unit: EquipmentOption) {
    const toMove = loggedSets.filter((s) => s.equipmentId == null && s.equipmentType === equipType);
    for (const st of toMove) {
      await editSet(st.localId!, { equipmentId: unit.id, equipmentLabel: unit.label, equipmentType: equipType });
    }
    if (toMove.length) onSessionChanged();
  }


  return (
    <li className={`${styles.card} ${completed ? styles.cardDone : ""}`}>
      <div className={styles.exHeader}>
        <button type="button" onClick={toggleCollapsed} className={styles.collapseBtn} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "▸" : "▾"}
        </button>
        <label className={styles.exName}>
          <input type="checkbox" checked={completed} onChange={(e) => onToggleComplete(ex.instanceId, e.target.checked)} title="Mark exercise done" />
          <strong>{activeExercise.name}</strong>
        </label>
        <ProvenanceBadge untagged={ex.untagged} />
        {collapsed && loggedSets.length > 0 && (
          <span className={styles.collapsedSummary}>{loggedSets.length} {loggedSets.length === 1 ? "set" : "sets"}</span>
        )}
        <span className={styles.tag}>[{ex.source}]</span>
        {activeExercise.id !== ex.exerciseId && (
          <span className={styles.tag}>
            (swapped from {ex.exerciseName} — <button type="button" onClick={resetSwap} className={styles.secondaryBtn}>reset</button>)
          </span>
        )}
        {!collapsed && ex.target && (
          <span className={styles.chip}>
            target: {ex.target.targetSets} × {ex.target.repRange ?? "?"} @ RIR {ex.target.rirTarget ?? "?"}
          </span>
        )}
        {!collapsed && <button type="button" onClick={openSwap} className={styles.secondaryBtn}>Swap</button>}
        <ReorderControls {...controls} />
      </div>

      {!collapsed && (
      <>
      <p className={styles.prev}>{previous ?? "…"}</p>

      {swapOpen && (
        <div style={{ fontSize: 13, border: "1px solid #333", borderRadius: 6, padding: 8, margin: "6px 0" }}>
          <p style={{ opacity: 0.7, margin: 0 }}>Deterministic candidates — preserve weekly stimulus, not the load number.</p>
          {swapCandidates?.length === 0 && <p>No candidates available.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {swapCandidates?.map((c) => (
              <li key={c.id}><button type="button" onClick={() => pickSwap(c)}>{c.name}</button> <span style={{ opacity: 0.6 }}>({c.loadType})</span></li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label title="How resistance is applied to this set. Pre-selected from the exercise — a visible default, always editable, never hidden.">
          Equipment{" "}
          <select value={equipType} onChange={(e) => pickType(e.target.value as EquipmentTypeId)}>
            {EQUIPMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        {contextBound && (
          <label title="Which unit — the same stack number means different resistance on different units, so each unit tracks its own lane. 'Unspecified' is a generic unit of this type (its own lane, not the free-weight lane).">
            <select value={equipmentId === "" ? UNSPECIFIED_UNIT : equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value={UNSPECIFIED_UNIT}>Unspecified unit</option>
              {equipmentUnits.map((m) => <option key={m.id} value={m.id}>{m.label}{m.builtInWeight != null ? ` (+${Number(m.builtInWeight)})` : ""}</option>)}
            </select>
            <button type="button" onClick={() => setUnitModalOpen(true)} className={styles.secondaryBtn} style={{ marginLeft: 4 }}>+ New unit…</button>
          </label>
        )}
        {offsetRelevant && (
        <label style={{ fontSize: 13, opacity: 0.9 }} title="Constant added weight this equipment contributes (bar, carriage). Pre-filled from the unit/type default; editing here overrides THIS set only — the stored default is unchanged. Weight YOU add (belt, vest) goes in the normal load input.">
          + built-in{" "}
          <input type="number" value={offsetInput} onChange={(e) => { setOffsetInput(e.target.value); if (!offsetConfirmed) confirmOffset(Number(e.target.value) || 0); }} placeholder={typeDef.defaultOffset == null ? "?" : "lb"} style={{ width: 48 }} />
        </label>
        )}
        {offsetNeedsConfirm && (
          <button type="button" onClick={() => confirmOffset(offsetNum)} className={styles.secondaryBtn} style={{ borderColor: "#a8741a", color: "#e0b566" }} title="A default offset is suggested but NOT applied until you confirm it — a wrong offset silently corrupts every set.">
            apply +{offsetNum} {typeDef.label.toLowerCase()}? ✓
          </button>
        )}
        {offsetRelevant && typeDef.defaultOffset == null && offsetInput.trim() === "" && (
          <span style={{ fontSize: 12, color: "#e0b566" }} title="Plate-loaded carriage/handle weight is unit-specific — set it rather than guessing. Until then, loads record what you put on.">
            carriage weight unknown — set it
          </span>
        )}
      </div>

      {unitModalOpen && (
        <AddUnitModal
          exerciseId={activeExercise.id}
          presetType={equipType}
          onClose={() => setUnitModalOpen(false)}
          onCreated={(unit) => {
            setUnitModalOpen(false);
            setEquipmentUnits((us) => [...us, unit]);
            setEquipmentId(unit.id);
            // Session-level relabel (3e): within one session you are demonstrably
            // on one unit — re-point THIS session's unspecified sets of this type
            // onto the named unit. Prior sessions are never backfilled (a guess).
            relabelSessionSets(unit);
            refreshEquipmentUnits();
          }}
        />
      )}

      <form onSubmit={handleAddSet} className={styles.entryForm}>
        <select value={setType} onChange={(e) => setSetType(e.target.value as "warmup" | "working")}>
          <option value="working">Working</option>
          <option value="warmup">Warm-up</option>
        </select>
        <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} title={ex.loadType === "bodyweight" ? "Added weight (0 = bodyweight)" : "Load"} />
        <span>{ex.loadType === "bodyweight" ? "added lb ×" : "lb ×"}</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} title="Reps" />
        <span>reps</span>
        {activeExercise.unilateral && (
          <span className={styles.effortPicker} title="Unilateral — which side is this set? Auto-alternates after each set.">
            {(["left", "right", "both"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} className={side === s ? styles.effortActive : styles.effortBtn}>
                {s === "left" ? "L" : s === "right" ? "R" : "Alternating"}
              </button>
            ))}
          </span>
        )}
        <button type="submit" className={styles.primary}>Add set</button>
        {effOffset !== 0 && (
          <span style={{ fontSize: 13, opacity: 0.85 }} title="Effective load = what you set + the known built-in weight. Progression uses the total.">
            = {load} + {effOffset} = <strong>{totalLoad} lb</strong>
          </span>
        )}
      </form>
      <div className={styles.effortRow}>
        <span className={styles.effortLabel}>Effort:</span>
        <EffortPicker value={effort} onChange={setEffort} />
      </div>
      {error && <p className={styles.error}>{error}</p>}

      {loggedSets.length > 0 && (
        <ul className={styles.logged}>
          {displaySets.map(({ set: s, isDrop }, i) => (
            // Rest is an edge: N sets = N−1 rests, so set 1 shows no chip at all
            // (its "rest" would be the inter-exercise transition — excluded).
            <LoggedSetRow key={s.localId} set={s} isDrop={isDrop} showRest={i > 0 && !isDrop} unilateral={activeExercise.unilateral} onChanged={onSessionChanged} onDrop={startDrop} />
          ))}
        </ul>
      )}

      {loggedSets.length > 0 && !completed && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 13, margin: "2px 0" }}>
          {heldRest != null ? (
            <span style={{ opacity: 0.9 }} title="Will be recorded automatically as the next set's rest (source: timed)">
              ⏱ rest {fmtRest(heldRest)} → next set{" "}
              <button type="button" onClick={() => setHeldRest(null)} className={styles.secondaryBtn} title="Discard this timed rest">✕</button>
            </span>
          ) : timerStart != null ? (
            <button type="button" onClick={() => { setHeldRest(Math.round((Date.now() - timerStart) / 1000)); setTimerStart(null); }} className={styles.secondaryBtn} title="Stop — the elapsed rest is written to your next set automatically">
              ⏱ {fmtRest(timerElapsed)} · stop
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setTimerStart(Date.now());
                  setTimerElapsed(0);
                  timerNotified.current = false;
                  const mins = Number(timerTargetMin);
                  if (Number.isFinite(mins) && mins > 0 && typeof Notification !== "undefined" && Notification.permission === "default") {
                    Notification.requestPermission().catch(() => {});
                  }
                }}
                className={styles.secondaryBtn}
                title="Start after racking — stopping (or hitting the target) records the rest on your next set automatically"
              >
                ⏱ Start rest
              </button>
              <input type="number" value={timerTargetMin} onChange={(e) => setTimerTargetMin(e.target.value)} placeholder="min" title="Optional target — stops the timer and notifies" style={{ width: 44, fontSize: 12 }} />
            </>
          )}
        </div>
      )}

      {dropFor && (
        <form onSubmit={addDrop} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "4px 0 4px 22px", fontSize: 14 }}>
          <span style={{ opacity: 0.75 }}>↳ drop of set {dropFor.setIndex}:</span>
          <input type="number" value={dropLoad} onChange={(e) => setDropLoad(e.target.value)} placeholder="lb" autoFocus style={{ width: 56 }} />
          <span>×</span>
          <input type="number" value={dropReps} onChange={(e) => setDropReps(Number(e.target.value))} style={{ width: 44 }} />
          <button type="submit" className={styles.primary}>Add drop</button>
          <button type="button" onClick={() => setDropFor(null)} className={styles.secondaryBtn}>Cancel</button>
        </form>
      )}

      <button type="button" onClick={checkProgression} disabled={checking} className={styles.secondaryBtn}>
        {checking ? "Checking…" : "Check progression"}
      </button>
      {progression && (
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
          {progression.status === "new_machine_baseline" ? (
            <p>Recalibrating for this unit — effort + volume carry over; you&rsquo;re not starting over.</p>
          ) : (
            <>
              <p>
                {progression.signal.type}
                {"reason" in progression.signal ? `: ${progression.signal.reason}` : ""}
                {progression.signal.type === "increase_load" && progression.signal.suggestedLoad != null ? ` (try ${progression.signal.suggestedLoad} lb)` : ""}
              </p>
              {progression.intervention && <p>Stall-buster: {progression.intervention.message}</p>}
            </>
          )}
        </div>
      )}
      </>
      )}
    </li>
  );
}

function CardioCard({
  ex,
  sessionId,
  date,
  controls,
  sessionCardio,
  completed,
  onSessionChanged,
  onToggleComplete,
}: {
  ex: LoggableOccurrence;
  sessionId: string;
  date: string;
  controls: CardControls;
  sessionCardio: SessionCardio[];
  completed: boolean;
  onSessionChanged: () => void;
  onToggleComplete: (instanceId: string, completed: boolean) => void;
}) {
  const p = ex.params ?? {};
  const [durationMin, setDurationMin] = useState<string>(String(num(p.duration_min) ?? ""));
  const [incline, setIncline] = useState<string>(String(num(p.incline) ?? ""));
  const [speed, setSpeed] = useState<string>(String(num(p.speed) ?? ""));
  const [distance, setDistance] = useState<string>("");
  const [level, setLevel] = useState<string>(String(num(p.level) ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });

  const fields = cardioFields(ex.exerciseName);
  const entries = sessionCardio.filter((c) => c.instanceId === ex.instanceId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/exercises/${ex.exerciseId}/last-session`);
      const data: { cardio: { durationMin: string | null; incline: string | null; speed: string | null } | null } = await res.json();
      if (cancelled) return;
      if (!data.cardio) setPrevious("No previous cardio yet");
      else {
        const bits = [
          data.cardio.durationMin ? `${data.cardio.durationMin} min` : null,
          data.cardio.incline ? `incline ${data.cardio.incline}` : null,
          data.cardio.speed ? `speed ${data.cardio.speed}` : null,
        ].filter(Boolean);
        setPrevious(`Last time: ${bits.join(", ") || "logged"}`);
      }
    })();
    return () => { cancelled = true; };
  }, [ex.exerciseId]);

  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    if (durationMin.trim() === "" && distance.trim() === "") {
      return setError("Enter at least a duration or distance.");
    }
    setError(null);
    await logCardio({
      sessionId,
      instanceId: ex.instanceId,
      date,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      durationMin: fields.includes("duration") ? toNum(durationMin) : null,
      incline: fields.includes("incline") ? toNum(incline) : null,
      speed: fields.includes("speed") ? toNum(speed) : null,
      distance: fields.includes("distance") ? toNum(distance) : null,
      level: fields.includes("level") ? toNum(level) : null,
      notes: null,
    });
    onSessionChanged();
  }

  return (
    <li className={`${styles.card} ${completed ? styles.cardDone : ""}`}>
      <div className={styles.exHeader}>
        <button type="button" onClick={toggleCollapsed} className={styles.collapseBtn} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "▸" : "▾"}
        </button>
        <label className={styles.exName}>
          <input type="checkbox" checked={completed} onChange={(e) => onToggleComplete(ex.instanceId, e.target.checked)} />
          <strong>{ex.exerciseName}</strong>
        </label>
        <ProvenanceBadge untagged={ex.untagged} />
        <span className={styles.tag}>cardio · [{ex.source}]</span>
        {collapsed && entries.length > 0 && (
          <span className={styles.collapsedSummary}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        )}
        <ReorderControls {...controls} />
      </div>

      {!collapsed && (
      <>
      <p className={styles.prev}>{previous ?? "…"}</p>

      <form onSubmit={handleLog} className={styles.entryForm}>
        {fields.includes("duration") && (
          <input type="number" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="min" title="Duration (min)" />
        )}
        {fields.includes("speed") && (
          <input type="number" value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder="speed" title="Speed" />
        )}
        {fields.includes("incline") && (
          <input type="number" value={incline} onChange={(e) => setIncline(e.target.value)} placeholder="incline" title="Incline" />
        )}
        {fields.includes("level") && (
          <input type="number" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="level" title="Level" />
        )}
        {fields.includes("distance") && (
          <input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="distance" title="Distance" />
        )}
        <button type="submit" className={styles.primary}>Log cardio</button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      {entries.length > 0 && (
        <ul className={styles.logged}>
          {entries.map((c) => (
            <li key={c.localId} className={styles.loggedRow}>
              <span className={c.syncState !== "synced" ? styles.pending : styles.synced} title={c.syncState !== "synced" ? "Not yet synced" : "Synced"}>
                {c.syncState !== "synced" ? "○" : "✓"}
              </span>
              <span>
                {[
                  c.durationMin != null ? `${c.durationMin} min` : null,
                  c.incline != null ? `incline ${c.incline}` : null,
                  c.speed != null ? `speed ${c.speed}` : null,
                  c.distance != null ? `${c.distance} dist` : null,
                  c.level != null ? `level ${c.level}` : null,
                ].filter(Boolean).join(", ") || "logged"}
              </span>
              <button type="button" onClick={async () => { await deleteCardio(c.localId!); onSessionChanged(); }} className={styles.secondaryBtn}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
    </li>
  );
}

function FinishSummary({
  session, occurrences, completed, sessionSets, sessionCardio, pending, onConfirm, onClose,
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
  // One row per performed occurrence, in order, with its own set/cardio/done —
  // regardless of source (bug 1b stays fixed under the occurrence model).
  const setsByInstance = new Map<string, number>();
  for (const s of sessionSets) setsByInstance.set(s.instanceId, (setsByInstance.get(s.instanceId) ?? 0) + 1);
  const cardioByInstance = new Map<string, number>();
  for (const c of sessionCardio) cardioByInstance.set(c.instanceId, (cardioByInstance.get(c.instanceId) ?? 0) + 1);

  const list = occurrences.map((o) => {
    const sets = setsByInstance.get(o.instanceId) ?? 0;
    const cardio = cardioByInstance.get(o.instanceId) ?? 0;
    const done = completed.has(o.instanceId);
    const bits: string[] = [];
    if (sets > 0) bits.push(`${sets} ${sets === 1 ? "set" : "sets"}`);
    if (cardio > 0) bits.push("cardio");
    if (bits.length === 0 && done) bits.push("done, no sets logged");
    return { instanceId: o.instanceId, name: o.exerciseName, desc: bits.join(" · ") };
  }).filter((r) => r.desc.length > 0);

  const setCount = sessionSets.length;

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <h2 style={{ marginTop: 0 }}>Finish session — {session.origin}</h2>
        <p>
          <strong>{setCount}</strong> {setCount === 1 ? "set" : "sets"} across <strong>{list.length}</strong>{" "}
          {list.length === 1 ? "exercise" : "exercises"}
          {sessionCardio.length > 0 && <> · <strong>{sessionCardio.length}</strong> cardio {sessionCardio.length === 1 ? "entry" : "entries"}</>}.
        </p>
        {list.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Nothing logged yet — you can still finish, or keep logging.</p>
        ) : (
          <ol style={{ paddingLeft: 18 }}>
            {list.map((r) => <li key={r.instanceId}>{r.name} — {r.desc}</li>)}
          </ol>
        )}
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          {pending > 0 ? `${pending} change(s) not yet synced — they'll sync when you're back online.` : "All changes synced."}
        </p>
        {session.finishedAt && (
          <p style={{ fontSize: 13, opacity: 0.7 }}>Previously finished at {new Date(session.finishedAt).toLocaleTimeString()} — finishing again re-stamps it.</p>
        )}
        <div className={styles.modalActions}>
          <button type="button" onClick={onConfirm} className={styles.primary}>Confirm finish</button>
          <button type="button" onClick={onClose}>Keep logging</button>
        </div>
      </div>
    </div>
  );
}

// The quick-add palette: tap any exercise to append it to the performed list.
// Program days and blocks are groups of one-tap chips; ad-hoc search + custom is
// always available. Adding is instant (the card appears above) and the palette
// stays open so you can add the next one mid-set.
function AddPalette({
  programs,
  blocks,
  onAdd,
  onAddAdhoc,
}: {
  programs: ProgramDetail[];
  blocks: BlockDetail[];
  onAdd: (ex: ProgramExerciseDetail, source: string) => void;
  onAddAdhoc: (r: ExerciseSearchResult) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Dedupe by label: the seed exposes e.g. "Abs"/"Cardio" as both a program day
  // and a reusable block — show each once (program day wins, added first).
  const groups: { key: string; label: string; source: string; exercises: ProgramExerciseDetail[] }[] = [];
  const seenLabels = new Set<string>();
  for (const prog of programs) {
    for (const d of prog.days) {
      const label = prettyDayName(d.name);
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      groups.push({ key: `d${d.id}`, label, source: label, exercises: d.exercises });
    }
  }
  for (const b of blocks) {
    if (seenLabels.has(b.name)) continue;
    seenLabels.add(b.name);
    groups.push({ key: `b${b.id}`, label: b.name, source: b.name, exercises: b.exercises });
  }

  return (
    <div className={styles.palette}>
      <div className={styles.paletteSearch}>
        <span style={{ fontSize: 13, opacity: 0.75 }}>Add any exercise:</span>
        <ExerciseSearch onPick={onAddAdhoc} placeholder="Search library / curated, or create custom…" />
      </div>
      <div className={styles.paletteGroups}>
        {groups.map((g) => (
          <div key={g.key} className={styles.paletteGroup}>
            <button
              type="button"
              className={styles.paletteGroupHeader}
              onClick={() => setOpenGroup((o) => (o === g.key ? null : g.key))}
            >
              {openGroup === g.key ? "▾" : "▸"} {g.label} <span style={{ opacity: 0.55 }}>({g.exercises.length})</span>
            </button>
            {openGroup === g.key && (
              <div className={styles.paletteChips}>
                {g.exercises.map((e) => (
                  <button key={e.id} type="button" className={styles.chipBtn} onClick={() => onAdd(e, g.source)}>
                    + {e.exerciseName}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LogSessionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<LocalSession | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound">("loading");
  const [blocks, setBlocks] = useState<BlockDetail[]>([]);
  const [allPrograms, setAllPrograms] = useState<ProgramDetail[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [sessionSets, setSessionSets] = useState<SessionSet[]>([]);
  const [sessionCardio, setSessionCardio] = useState<SessionCardio[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncError, setSyncError] = useState<"auth" | "network" | "server" | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);

  const refreshSession = useCallback(async () => {
    const [occ, sets, cardio, done, p, s] = await Promise.all([
      listOccurrences(sessionId), getSessionSets(sessionId), getSessionCardio(sessionId),
      getCompletedInstances(sessionId), pendingCount(sessionId), getSession(sessionId),
    ]);
    setOccurrences(occ);
    setSessionSets(sets);
    setSessionCardio(cardio);
    setCompleted(done);
    setPending(p);
    if (s) setSession(s);
  }, [sessionId]);

  const onSessionChanged = useCallback(async () => {
    await refreshSession();
    await sync().catch(() => {});
    await refreshSession();
  }, [refreshSession]);

  const handleSync = useCallback(async () => {
    const r = await sync();
    setSyncError(r.authError ? "auth" : r.networkError ? "network" : r.serverError ? "server" : null);
    setSyncStatus(`Synced: +${r.created} ~${r.updated} −${r.deleted}${r.finished ? ` finish×${r.finished}` : ""}${r.failed ? `, ${r.failed} still pending` : ""}`);
    await refreshSession();
  }, [refreshSession]);

  const toggleComplete = useCallback(async (instanceId: string, isComplete: boolean) => {
    await setOccurrenceCompleted(sessionId, instanceId, isComplete);
    await refreshSession();
  }, [sessionId, refreshSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let s = await getSession(sessionId);
      if (!s) {
        try {
          const res = await fetch(`/api/sessions/${sessionId}`);
          if (res.ok) s = await hydrateFromServer(await res.json());
        } catch {
          /* offline and not local — can't show it */
        }
      }
      if (cancelled) return;
      if (!s) {
        setLoadState("notfound");
        return;
      }
      setSession(s);
      setLoadState("ready");
      await refreshSession();

      const blocksRes = await fetch("/api/blocks").then((r) => (r.ok ? (r.json() as Promise<BlockDetail[]>) : []));
      if (cancelled) return;
      setBlocks(blocksRes);

      const summaries = await fetch("/api/programs").then((r) => (r.ok ? r.json() : []));
      const full = await Promise.all(
        (summaries as { id: number }[]).map((p) =>
          fetch(`/api/programs/${p.id}`).then((r) => (r.ok ? (r.json() as Promise<ProgramDetail>) : null))
        )
      );
      if (!cancelled) setAllPrograms(full.filter((p): p is ProgramDetail => p !== null));
    })();
    const onFocus = () => { if (document.visibilityState === "visible") handleSync(); };
    window.addEventListener("online", handleSync);
    window.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleSync);
      window.removeEventListener("visibilitychange", onFocus);
    };
  }, [sessionId, handleSync, refreshSession]);

  const loggables: LoggableOccurrence[] = useMemo(() => {
    return occurrences.map((o) => ({
      instanceId: o.instanceId,
      orderIndex: o.orderIndex,
      exerciseId: o.exerciseId,
      exerciseName: o.exerciseName,
      loadType: o.loadType,
      portable: o.portable,
      conditioningOnly: o.conditioningOnly,
      target: o.targetSets != null ? { targetSets: o.targetSets, repRange: o.repRange, rirTarget: o.rirTarget } : null,
      params: o.params,
      source: o.source,
      provenance: o.provenance,
      untagged: o.untagged,
      unilateral: o.unilateral ?? false,
    }));
  }, [occurrences]);

  const attachFrom = (e: ProgramExerciseDetail): AttachExercise => ({
    exerciseId: e.exerciseId,
    exerciseName: e.exerciseName,
    loadType: e.loadType,
    portable: e.portable,
    conditioningOnly: e.conditioningOnly,
    provenance: e.source,
    untagged: e.untagged,
    unilateral: e.unilateral ?? false,
    targetSets: e.targetSets,
    repRange: e.repRange,
    rirTarget: e.rirTarget,
    params: e.params,
  });

  async function addFromPalette(e: ProgramExerciseDetail, source: string) {
    await addOccurrence(sessionId, attachFrom(e), source);
    await refreshSession();
  }

  async function addAdhoc(r: ExerciseSearchResult) {
    await addOccurrence(
      sessionId,
      {
        exerciseId: r.id,
        exerciseName: r.name,
        loadType: r.loadType,
        portable: r.portable,
        conditioningOnly: r.conditioningOnly,
        provenance: r.source,
        untagged: r.untagged,
        unilateral: r.unilateral ?? false,
      },
      "Ad-hoc"
    );
    await refreshSession();
  }

  async function move(instanceId: string, dir: "up" | "down") {
    await moveOccurrence(sessionId, instanceId, dir);
    await refreshSession();
  }

  async function remove(instanceId: string) {
    await removeOccurrence(sessionId, instanceId);
    await onSessionChanged();
  }

  async function confirmFinish() {
    await finishSession(sessionId);
    setShowFinish(false);
    await sync().catch(() => {});
    router.push("/sessions");
  }

  if (loadState === "loading") {
    return <main className={styles.page}><p>Loading session…</p></main>;
  }
  if (loadState === "notfound" || !session) {
    return (
      <main className={styles.page}>
        <p>Session not found. It may only exist on another device — reconnect and open it from the <Link href="/sessions">sessions list</Link>.</p>
      </main>
    );
  }

  const totalLogged = sessionSets.length + sessionCardio.length;
  const date = session.date;

  return (
    <main className={styles.page}>
      <div className={styles.statusBar}>
        <Link href="/sessions" className={styles.secondaryBtn}>← Sessions</Link>
        <span>{pending > 0 ? `${pending} change(s) pending sync` : "All changes synced"}</span>
        <button onClick={handleSync} className={styles.secondaryBtn}>Sync now</button>
        {syncError === "auth" ? (
          <span className={styles.syncErr}>
            Session expired —{" "}
            <a href={`/login?next=${encodeURIComponent(`/log/${sessionId}`)}`} className={styles.reloginLink}>re-login to sync</a>
          </span>
        ) : syncError === "network" ? (
          <span className={styles.syncErr}>Offline — {pending} change(s) will sync when you reconnect</span>
        ) : syncError === "server" ? (
          <span className={styles.syncErr}>Sync error — will retry</span>
        ) : null}
        {session.finishedAt && <span>· finished {new Date(session.finishedAt).toLocaleTimeString()}</span>}
        {syncStatus && !syncError && <span>· {syncStatus}</span>}
      </div>

      <h1>
        {session.origin}{" "}
        <SessionDateEditor session={session} onChanged={async () => { await refreshSession(); handleSync(); }} />
      </h1>

      <div className={styles.addRow}>
        <button type="button" onClick={() => setPaletteOpen((o) => !o)} className={styles.primary}>
          {paletteOpen ? "Hide add panel" : "+ Add exercise"}
        </button>
        <span style={{ fontSize: 13, opacity: 0.65 }}>Tap to add as you go — order is kept.</span>
      </div>

      {paletteOpen && (
        <AddPalette programs={allPrograms} blocks={blocks} onAdd={addFromPalette} onAddAdhoc={addAdhoc} />
      )}

      {loggables.length === 0 ? (
        <p style={{ opacity: 0.65 }}>Nothing added yet — add your first exercise above. Add more as you do them; the order is your session record.</p>
      ) : (
        <ol className={styles.list}>
          {loggables.map((ex, i) => {
            const controls: CardControls = {
              position: i,
              total: loggables.length,
              onMoveUp: () => move(ex.instanceId, "up"),
              onMoveDown: () => move(ex.instanceId, "down"),
              onRemove: () => remove(ex.instanceId),
            };
            return ex.conditioningOnly ? (
              <CardioCard
                key={ex.instanceId}
                ex={ex}
                sessionId={sessionId}
                date={date}
                controls={controls}
                sessionCardio={sessionCardio}
                completed={completed.has(ex.instanceId)}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
              />
            ) : (
              <StrengthCard
                key={ex.instanceId}
                ex={ex}
                sessionId={sessionId}
                date={date}
                controls={controls}
                sessionSets={sessionSets}
                completed={completed.has(ex.instanceId)}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
              />
            );
          })}
        </ol>
      )}

      <div className={styles.finishBar}>
        <span className={styles.links}>
          <Link href="/sessions">Sessions</Link>
          <Link href="/program">Program</Link>
          <Link href="/blocks">Blocks</Link>
        </span>
        <button type="button" onClick={() => setShowFinish(true)} className={styles.primary}>
          Finish session ({totalLogged})
        </button>
      </div>

      {showFinish && (
        <FinishSummary
          session={session}
          occurrences={occurrences}
          completed={completed}
          sessionSets={sessionSets}
          sessionCardio={sessionCardio}
          pending={pending}
          onConfirm={confirmFinish}
          onClose={() => setShowFinish(false)}
        />
      )}
    </main>
  );
}
