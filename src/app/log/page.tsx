"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./log.module.css";
import { ExerciseSearch, ProvenanceBadge, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import {
  logSet,
  editSet,
  deleteSet,
  getSessionSets,
  getCompletedExercises,
  setExerciseCompleted,
  getSessionMeta,
  finishSession,
  sync,
  pendingCount,
  attachToComposition,
  getSessionComposition,
  removeFromComposition,
  logCardio,
  getSessionCardio,
  deleteCardio,
  type SessionSet,
  type SessionMeta,
  type SessionCardio,
  type CompositionItem,
  type AttachExercise,
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

interface MachineOption {
  id: string;
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

// Unified shape for anything loggable in a session — a program exercise or a
// composition (block / ad-hoc) item. `target` is present only for program
// exercises; composition items are removable from the session.
interface LoggableExercise {
  key: string;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  target: { targetSets: number; repRange: string | null; rirTarget: string | null } | null;
  params: Record<string, unknown> | null;
  origin: string | null; // where it came from in the session: "block:Cardio" — null for program-day exercises
  provenance: string; // curated | library | custom
  untagged: boolean;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function parseRepRangeMax(repRange: string | null): number {
  if (!repRange) return 12;
  const parts = repRange.split("-");
  const max = Number(parts[parts.length - 1]);
  return Number.isFinite(max) ? max : 12;
}
function lastMachineKey(exerciseId: string) {
  return `fitness-app:last-machine:${exerciseId}`;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

// The machine label only makes sense for context-bound loads (spec §9). Never
// shown for dumbbell/bodyweight/free weight.
const MACHINE_LOAD_TYPES = new Set(["machine_selectorized", "cable", "smith", "plate_loaded"]);
function usesMachineTag(loadType: string): boolean {
  return MACHINE_LOAD_TYPES.has(loadType);
}

// Which cardio fields are relevant depends on the machine. Inferred from the
// exercise name (curated cardio + library cardio have descriptive names); an
// unknown type falls back to duration + distance. Drives the visible inputs so
// irrelevant ones are hidden (spec Part 5).
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

// One-tap effort picker (replaces asking for an RIR number). Highlights the
// chosen tag.
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

function LoggedSetRow({ set, onChanged }: { set: SessionSet; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [load, setLoad] = useState(set.load);
  const [reps, setReps] = useState(set.reps);
  const [effort, setEffort] = useState<EffortTag | null>(set.effort);
  const pending = set.syncState !== "synced";

  async function save() {
    if (reps < 1 || load < 0) return;
    await editSet(set.localId!, { load, reps, effort });
    setEditing(false);
    onChanged();
  }
  async function remove() {
    await deleteSet(set.localId!);
    onChanged();
  }

  if (editing) {
    return (
      <li style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "3px 0", fontSize: 14 }}>
        <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 56 }} />
        <span>×</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 44 }} />
        <EffortPicker value={effort} onChange={setEffort} />
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </li>
    );
  }
  return (
    <li className={styles.loggedRow}>
      <span className={pending ? styles.pending : styles.synced} title={pending ? "Not yet synced" : "Synced"}>
        {pending ? "○" : "✓"}
      </span>
      <span>
        {set.setType === "warmup" ? "Warm-up" : "Working"}: {set.load} lb × {set.reps}
        {set.effort ? ` · ${EFFORT_LABEL[set.effort]}` : ""}
      </span>
      <button type="button" onClick={() => setEditing(true)} className={styles.secondaryBtn}>Edit</button>
      <button type="button" onClick={remove} className={styles.secondaryBtn}>Delete</button>
    </li>
  );
}

function StrengthCard({
  ex,
  machines,
  sessionSets,
  completed,
  onMachineAdded,
  onSessionChanged,
  onToggleComplete,
  onRemoveFromSession,
}: {
  ex: LoggableExercise;
  machines: MachineOption[];
  sessionSets: SessionSet[];
  completed: boolean;
  onMachineAdded: () => void;
  onSessionChanged: () => void;
  onToggleComplete: (exerciseId: string, completed: boolean) => void;
  onRemoveFromSession: ((exerciseId: string) => void) | null;
}) {
  const [activeExercise, setActiveExercise] = useState({
    id: ex.exerciseId,
    name: ex.exerciseName,
    loadType: ex.loadType,
    portable: ex.portable,
  });
  const [machineId, setMachineId] = useState(() => {
    if (ex.portable || typeof window === "undefined") return "";
    return localStorage.getItem(lastMachineKey(ex.exerciseId)) ?? "";
  });
  const [newMachineName, setNewMachineName] = useState("");
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  // Bodyweight lifts default to no added weight; loaded lifts to a nominal 45.
  const [load, setLoad] = useState(ex.loadType === "bodyweight" ? 0 : 45);
  const [reps, setReps] = useState(8);
  const [effort, setEffort] = useState<EffortTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);

  const showMachine = usesMachineTag(activeExercise.loadType);
  const resolvedMachineId = !showMachine ? null : machineId.trim() || null;
  const loggedSets = sessionSets.filter((s) => s.exerciseId === activeExercise.id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (resolvedMachineId) params.set("machineId", resolvedMachineId);
      const res = await fetch(`/api/exercises/${activeExercise.id}/last-session?${params.toString()}`);
      const data: { session: { sets: Array<{ load: number; reps: number }> } | null } = await res.json();
      if (cancelled) return;
      if (!data.session) setPrevious("No previous session yet");
      else {
        const reps = data.session.sets.map((s) => s.reps).join(", ");
        setPrevious(`Last time: ${data.session.sets[0]?.load ?? "?"} × ${reps}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeExercise.id, resolvedMachineId]);

  const checkProgression = useCallback(async () => {
    setChecking(true);
    try {
      const params = new URLSearchParams({
        exerciseId: activeExercise.id,
        repRangeMax: String(parseRepRangeMax(ex.target?.repRange ?? null)),
        targetRir: String(ex.target?.rirTarget ?? 2),
      });
      if (resolvedMachineId) params.set("machineId", resolvedMachineId);
      const res = await fetch(`/api/progression?${params.toString()}`);
      setProgression(await res.json());
    } finally {
      setChecking(false);
    }
  }, [activeExercise.id, ex.target, resolvedMachineId]);

  async function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(reps) || reps < 1) return setError("Reps must be at least 1.");
    if (!Number.isFinite(load) || load < 0) return setError("Load can't be negative.");
    setError(null);
    await logSet({
      date: todayIso(),
      exerciseId: activeExercise.id,
      exerciseName: activeExercise.name,
      machineId: resolvedMachineId,
      setType,
      load,
      reps,
      effort,
      rir: null,
    });
    if (resolvedMachineId) localStorage.setItem(lastMachineKey(activeExercise.id), resolvedMachineId);
    onSessionChanged();
  }

  async function openSwap() {
    setSwapOpen((o) => !o);
    if (swapCandidates) return;
    const res = await fetch(`/api/substitutions?exerciseId=${encodeURIComponent(ex.exerciseId)}`);
    setSwapCandidates(await res.json());
  }
  function pickSwap(c: SubstitutionCandidate) {
    setActiveExercise({ id: c.id, name: c.name, loadType: c.loadType, portable: c.portable });
    setMachineId(c.portable ? "" : localStorage.getItem(lastMachineKey(c.id)) ?? "");
    setSwapOpen(false);
  }
  function resetSwap() {
    setActiveExercise({ id: ex.exerciseId, name: ex.exerciseName, loadType: ex.loadType, portable: ex.portable });
    setMachineId(ex.portable ? "" : localStorage.getItem(lastMachineKey(ex.exerciseId)) ?? "");
    setSwapOpen(false);
  }
  async function addMachine() {
    const name = newMachineName.trim();
    if (!name) return;
    setMachineId(name);
    setNewMachineName("");
    try {
      const res = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: name }),
      });
      if (res.ok) onMachineAdded();
    } catch {
      /* offline — set-logs auto-registers on sync */
    }
  }

  return (
    <li className={`${styles.card} ${completed ? styles.cardDone : ""} ${ex.origin ? styles.cardAdhoc : ""}`}>
      <div className={styles.exHeader}>
        <label className={styles.exName}>
          <input type="checkbox" checked={completed} onChange={(e) => onToggleComplete(ex.exerciseId, e.target.checked)} title="Mark exercise done" />
          <strong>{activeExercise.name}</strong>
        </label>
        <ProvenanceBadge source={ex.provenance} untagged={ex.untagged} />
        {ex.origin && <span className={styles.tag}>[{ex.origin}]</span>}
        {ex.untagged && <span className={styles.tag}>· not counted in volume until tagged</span>}
        {activeExercise.id !== ex.exerciseId && (
          <span className={styles.tag}>
            (swapped from {ex.exerciseName} — <button type="button" onClick={resetSwap} className={styles.secondaryBtn}>reset</button>)
          </span>
        )}
        {ex.target && (
          <span className={styles.chip}>
            target: {ex.target.targetSets} × {ex.target.repRange ?? "?"} @ RIR {ex.target.rirTarget ?? "?"}
          </span>
        )}
        <button type="button" onClick={openSwap} className={styles.secondaryBtn}>Swap</button>
        {onRemoveFromSession && (
          <button type="button" onClick={() => onRemoveFromSession(ex.exerciseId)} className={styles.secondaryBtn}>Remove</button>
        )}
      </div>

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

      {showMachine && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label title="A personal label you make up — not a number on the machine. Only add one if there are two of the same machine, or you're at a different gym.">
            Machine{" "}
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">(none — one machine here)</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </label>
          <input value={newMachineName} onChange={(e) => setNewMachineName(e.target.value)} placeholder='label it, e.g. "leg ext by the mirror"' style={{ width: 200 }} />
          <button type="button" onClick={addMachine}>+ Add</button>
        </div>
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
        <button type="submit" className={styles.primary}>Add set</button>
      </form>
      <div className={styles.effortRow}>
        <span className={styles.effortLabel}>Effort:</span>
        <EffortPicker value={effort} onChange={setEffort} />
      </div>
      {error && <p className={styles.error}>{error}</p>}

      {loggedSets.length > 0 && (
        <ul className={styles.logged}>
          {loggedSets.map((s) => <LoggedSetRow key={s.localId} set={s} onChanged={onSessionChanged} />)}
        </ul>
      )}

      <button type="button" onClick={checkProgression} disabled={checking} className={styles.secondaryBtn}>
        {checking ? "Checking…" : "Check progression"}
      </button>
      {progression && (
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
          {progression.status === "new_machine_baseline" ? (
            <p>New machine — re-baselining, not a stall.</p>
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
    </li>
  );
}

function CardioCard({
  ex,
  sessionCardio,
  completed,
  onSessionChanged,
  onToggleComplete,
  onRemoveFromSession,
}: {
  ex: LoggableExercise;
  sessionCardio: SessionCardio[];
  completed: boolean;
  onSessionChanged: () => void;
  onToggleComplete: (exerciseId: string, completed: boolean) => void;
  onRemoveFromSession: ((exerciseId: string) => void) | null;
}) {
  const p = ex.params ?? {};
  const [durationMin, setDurationMin] = useState<string>(String(num(p.duration_min) ?? ""));
  const [incline, setIncline] = useState<string>(String(num(p.incline) ?? ""));
  const [speed, setSpeed] = useState<string>(String(num(p.speed) ?? ""));
  const [distance, setDistance] = useState<string>("");
  const [level, setLevel] = useState<string>(String(num(p.level) ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  const fields = cardioFields(ex.exerciseName);
  const entries = sessionCardio.filter((c) => c.exerciseId === ex.exerciseId);

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
    // Only persist the fields relevant to this cardio type; the rest are null.
    await logCardio({
      date: todayIso(),
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
    <li className={`${styles.card} ${completed ? styles.cardDone : ""} ${ex.origin ? styles.cardAdhoc : ""}`}>
      <div className={styles.exHeader}>
        <label className={styles.exName}>
          <input type="checkbox" checked={completed} onChange={(e) => onToggleComplete(ex.exerciseId, e.target.checked)} />
          <strong>{ex.exerciseName}</strong>
        </label>
        <ProvenanceBadge source={ex.provenance} untagged={ex.untagged} />
        <span className={styles.tag}>cardio{ex.origin ? ` · ${ex.origin}` : ""}</span>
        {onRemoveFromSession && (
          <button type="button" onClick={() => onRemoveFromSession(ex.exerciseId)} className={styles.secondaryBtn}>Remove</button>
        )}
      </div>
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
    </li>
  );
}

function FinishSummary({
  date, sessionSets, sessionCardio, dayExerciseCount, meta, pending, onConfirm, onClose,
}: {
  date: string;
  sessionSets: SessionSet[];
  sessionCardio: SessionCardio[];
  dayExerciseCount: number;
  meta: SessionMeta | null;
  pending: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const byExercise = new Map<string, { name: string; count: number }>();
  for (const s of sessionSets) {
    const cur = byExercise.get(s.exerciseId) ?? { name: s.exerciseName, count: 0 };
    cur.count += 1;
    byExercise.set(s.exerciseId, cur);
  }
  const setCount = sessionSets.length;

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <h2 style={{ marginTop: 0 }}>Finish session — {date}</h2>
        <p>
          <strong>{setCount}</strong> {setCount === 1 ? "set" : "sets"} across <strong>{byExercise.size}</strong> of {dayExerciseCount} program{" "}
          {dayExerciseCount === 1 ? "exercise" : "exercises"}
          {sessionCardio.length > 0 && <> · <strong>{sessionCardio.length}</strong> cardio {sessionCardio.length === 1 ? "entry" : "entries"}</>}.
        </p>
        {byExercise.size === 0 && sessionCardio.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Nothing logged yet — you can still finish, or keep logging.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {Array.from(byExercise.values()).map((e) => <li key={e.name}>{e.name} — {e.count} {e.count === 1 ? "set" : "sets"}</li>)}
            {sessionCardio.map((c) => <li key={c.localId}>{c.exerciseName} — cardio</li>)}
          </ul>
        )}
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          {pending > 0 ? `${pending} change(s) not yet synced — they'll sync when you're back online.` : "All changes synced."}
        </p>
        {meta?.finishedAt && (
          <p style={{ fontSize: 13, opacity: 0.7 }}>Previously finished at {new Date(meta.finishedAt).toLocaleTimeString()} — finishing again re-stamps it.</p>
        )}
        <div className={styles.modalActions}>
          <button type="button" onClick={onConfirm} className={styles.primary}>Confirm finish</button>
          <button type="button" onClick={onClose}>Keep logging</button>
        </div>
      </div>
    </div>
  );
}

export default function LogPage() {
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [blocks, setBlocks] = useState<BlockDetail[]>([]);
  const [sessionSets, setSessionSets] = useState<SessionSet[]>([]);
  const [sessionCardio, setSessionCardio] = useState<SessionCardio[]>([]);
  const [composition, setComposition] = useState<CompositionItem[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [pending, setPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const [showFinish, setShowFinish] = useState(false);
  const [blockToAdd, setBlockToAdd] = useState("");

  const date = todayIso();

  const refreshSession = useCallback(async () => {
    const [sets, cardio, comp, done, m, p] = await Promise.all([
      getSessionSets(date), getSessionCardio(date), getSessionComposition(date),
      getCompletedExercises(date), getSessionMeta(date), pendingCount(date),
    ]);
    setSessionSets(sets);
    setSessionCardio(cardio);
    setComposition(comp);
    setCompleted(done);
    setMeta(m);
    setPending(p);
  }, [date]);

  const refreshMachines = useCallback(async () => {
    const res = await fetch("/api/machines");
    if (res.ok) setMachines(await res.json());
  }, []);

  const onSessionChanged = useCallback(async () => {
    await refreshSession();
    await sync().catch(() => {});
    await refreshSession();
  }, [refreshSession]);

  const handleSync = useCallback(async () => {
    const r = await sync();
    setSyncStatus(`Synced: +${r.created} ~${r.updated} −${r.deleted}${r.finished ? ` finish×${r.finished}` : ""}${r.failed ? `, ${r.failed} still pending` : ""}`);
    await refreshSession();
  }, [refreshSession]);

  const toggleComplete = useCallback(async (exerciseId: string, isComplete: boolean) => {
    await setExerciseCompleted(date, exerciseId, isComplete);
    await refreshSession();
  }, [date, refreshSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [programRes, machinesRes, blocksRes] = await Promise.all([
        fetch("/api/program").then((r) => (r.ok ? (r.json() as Promise<ProgramDetail>) : null)),
        fetch("/api/machines").then((r) => (r.ok ? (r.json() as Promise<MachineOption[]>) : [])),
        fetch("/api/blocks").then((r) => (r.ok ? (r.json() as Promise<BlockDetail[]>) : [])),
      ]);
      if (cancelled) return;
      setProgram(programRes);
      if (programRes && programRes.days.length > 0) setSelectedDayId(programRes.days[0].id);
      setMachines(machinesRes);
      setBlocks(blocksRes);
      await refreshSession();
    })();
    window.addEventListener("online", handleSync);
    return () => { cancelled = true; window.removeEventListener("online", handleSync); };
  }, [handleSync, refreshSession]);

  const currentDay = useMemo(() => program?.days.find((d) => d.id === selectedDayId) ?? null, [program, selectedDayId]);

  // Merge program-day exercises with composition (block/ad-hoc) items into one
  // loggable list; composition items already present in the day are skipped.
  const loggables: LoggableExercise[] = useMemo(() => {
    const dayIds = new Set((currentDay?.exercises ?? []).map((e) => e.exerciseId));
    const fromProgram: LoggableExercise[] = (currentDay?.exercises ?? []).map((e) => ({
      key: `pe:${e.id}`,
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      loadType: e.loadType,
      portable: e.portable,
      conditioningOnly: e.conditioningOnly,
      target: { targetSets: e.targetSets, repRange: e.repRange, rirTarget: e.rirTarget },
      params: e.params,
      origin: null,
      provenance: e.source,
      untagged: e.untagged,
    }));
    const fromComposition: LoggableExercise[] = composition
      .filter((c) => !dayIds.has(c.exerciseId))
      .map((c) => ({
        key: `co:${c.exerciseId}`,
        exerciseId: c.exerciseId,
        exerciseName: c.exerciseName,
        loadType: c.loadType,
        portable: c.portable,
        conditioningOnly: c.conditioningOnly,
        target: null,
        params: null,
        origin: c.source,
        provenance: c.provenance,
        untagged: c.untagged,
      }));
    return [...fromProgram, ...fromComposition];
  }, [currentDay, composition]);

  async function addBlock() {
    const block = blocks.find((b) => String(b.id) === blockToAdd);
    if (!block) return;
    const items: AttachExercise[] = block.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      loadType: e.loadType,
      portable: e.portable,
      conditioningOnly: e.conditioningOnly,
      provenance: e.source,
      untagged: e.untagged,
    }));
    await attachToComposition(date, items, `block:${block.name}`);
    setBlockToAdd("");
    await refreshSession();
  }

  // Ad-hoc add via search (library/curated) or a just-created custom — attaches
  // to the SESSION only (no program/block created).
  async function addAdhocExercise(r: ExerciseSearchResult) {
    await attachToComposition(
      date,
      [{
        exerciseId: r.id,
        exerciseName: r.name,
        loadType: r.loadType,
        portable: r.portable,
        conditioningOnly: r.conditioningOnly,
        provenance: r.source,
        untagged: r.untagged,
      }],
      "adhoc"
    );
    await refreshSession();
  }

  async function removeFromSession(exerciseId: string) {
    await removeFromComposition(date, exerciseId);
    await refreshSession();
  }

  async function confirmFinish() {
    await finishSession(date);
    setShowFinish(false);
    await onSessionChanged();
    setSyncStatus("Session finished.");
  }

  const strengthExerciseCount = currentDay?.exercises.filter((e) => !e.conditioningOnly).length ?? 0;
  const totalLogged = sessionSets.length + sessionCardio.length;

  return (
    <main className={styles.page}>
      <h1>Log a session</h1>
      <div className={styles.statusBar}>
        <span>{pending > 0 ? `${pending} change(s) pending sync` : "All changes synced"}</span>
        <button onClick={handleSync} className={styles.secondaryBtn}>Sync now</button>
        {meta?.finishedAt && <span>· finished {new Date(meta.finishedAt).toLocaleTimeString()}</span>}
        {syncStatus && <span>· {syncStatus}</span>}
      </div>

      {!program ? (
        <p>No active program. Visit <Link href="/program">/program</Link> to create one, or run `npm run db:seed`.</p>
      ) : (
        <>
          <div className={styles.dayTabs}>
            {program.days.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDayId(d.id)}
                className={d.id === selectedDayId ? styles.dayTabActive : styles.dayTab}
              >
                {d.name}
              </button>
            ))}
          </div>

          <div className={styles.addRow}>
            <span>
              Add block:
              <select value={blockToAdd} onChange={(e) => setBlockToAdd(e.target.value)}>
                <option value="">choose…</option>
                {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button type="button" onClick={addBlock} disabled={!blockToAdd} className={styles.secondaryBtn}>Attach</button>
            </span>
            <span style={{ flex: "1 1 240px" }}>
              Add exercise:
              <ExerciseSearch onPick={addAdhocExercise} placeholder="Search library / curated, or create custom…" />
            </span>
          </div>

          <ul className={styles.list}>
            {loggables.map((ex) =>
              ex.conditioningOnly ? (
                <CardioCard
                  key={ex.key}
                  ex={ex}
                  sessionCardio={sessionCardio}
                  completed={completed.has(ex.exerciseId)}
                  onSessionChanged={onSessionChanged}
                  onToggleComplete={toggleComplete}
                  onRemoveFromSession={ex.origin ? removeFromSession : null}
                />
              ) : (
                <StrengthCard
                  key={ex.key}
                  ex={ex}
                  machines={machines}
                  sessionSets={sessionSets}
                  completed={completed.has(ex.exerciseId)}
                  onMachineAdded={refreshMachines}
                  onSessionChanged={onSessionChanged}
                  onToggleComplete={toggleComplete}
                  onRemoveFromSession={ex.origin ? removeFromSession : null}
                />
              )
            )}
          </ul>
        </>
      )}

      <div className={styles.finishBar}>
        <span className={styles.links}>
          <Link href="/program">Program</Link>
          <Link href="/blocks">Blocks</Link>
        </span>
        <button type="button" onClick={() => setShowFinish(true)} className={styles.primary}>
          Finish session ({totalLogged})
        </button>
      </div>

      {showFinish && (
        <FinishSummary
          date={date}
          sessionSets={sessionSets}
          sessionCardio={sessionCardio}
          dayExerciseCount={strengthExerciseCount}
          meta={meta}
          pending={pending}
          onConfirm={confirmFinish}
          onClose={() => setShowFinish(false)}
        />
      )}
    </main>
  );
}
