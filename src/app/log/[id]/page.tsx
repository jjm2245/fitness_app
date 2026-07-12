"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import styles from "../log.module.css";
import { ExerciseSearch, ProvenanceBadge, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import { prettyDayName } from "@/lib/labels";
import {
  logSet,
  editSet,
  deleteSet,
  getSessionSets,
  getCompletedExercises,
  setExerciseCompleted,
  getSession,
  hydrateFromServer,
  finishSession,
  sync,
  pendingCount,
  attachToComposition,
  getSessionComposition,
  removeFromComposition,
  logCardio,
  getSessionCardio,
  deleteCardio,
  type LocalSession,
  type SessionSet,
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

// Unified shape for anything loggable in a session. Every card comes from the
// session's composition now (the session is self-contained); `target` is
// present when the item carried a program-day prescription.
interface LoggableExercise {
  key: string;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  target: { targetSets: number; repRange: string | null; rirTarget: string | null } | null;
  params: Record<string, unknown> | null;
  origin: string | null; // where it came from in the session
  provenance: string; // curated | library | custom
  untagged: boolean;
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

const MACHINE_LOAD_TYPES = new Set(["machine_selectorized", "cable", "smith", "plate_loaded"]);
function usesMachineTag(loadType: string): boolean {
  return MACHINE_LOAD_TYPES.has(loadType);
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
  sessionId,
  date,
  machines,
  sessionSets,
  completed,
  onMachineAdded,
  onSessionChanged,
  onToggleComplete,
  onRemoveFromSession,
}: {
  ex: LoggableExercise;
  sessionId: string;
  date: string;
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
  const [load, setLoad] = useState(ex.loadType === "bodyweight" ? 0 : 45);
  const [reps, setReps] = useState(8);
  const [effort, setEffort] = useState<EffortTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);
  // Collapsible card (Part C): name stays visible when collapsed; completing an
  // exercise auto-collapses it. A manual toggle is remembered against the
  // completion state it was made under, so it wins until completion flips —
  // then we fall back to the auto behavior (complete ⇒ collapsed), even for a
  // card you'd manually expanded. Derived, not an effect (no cascading renders).
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });

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
      sessionId,
      date,
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
        <button type="button" onClick={toggleCollapsed} className={styles.collapseBtn} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "▸" : "▾"}
        </button>
        <label className={styles.exName}>
          <input type="checkbox" checked={completed} onChange={(e) => onToggleComplete(ex.exerciseId, e.target.checked)} title="Mark exercise done" />
          <strong>{activeExercise.name}</strong>
        </label>
        <ProvenanceBadge untagged={ex.untagged} />
        {collapsed && loggedSets.length > 0 && (
          <span className={styles.collapsedSummary}>{loggedSets.length} {loggedSets.length === 1 ? "set" : "sets"}</span>
        )}
        {ex.origin && <span className={styles.tag}>[{ex.origin}]</span>}
        {ex.untagged && <span className={styles.tag}>· untagged — tag a movement pattern to make it substitutable</span>}
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
        {!collapsed && onRemoveFromSession && (
          <button type="button" onClick={() => onRemoveFromSession(ex.exerciseId)} className={styles.secondaryBtn}>Remove</button>
        )}
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
      </>
      )}
    </li>
  );
}

function CardioCard({
  ex,
  sessionId,
  date,
  sessionCardio,
  completed,
  onSessionChanged,
  onToggleComplete,
  onRemoveFromSession,
}: {
  ex: LoggableExercise;
  sessionId: string;
  date: string;
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
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });

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
    await logCardio({
      sessionId,
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
    <li className={`${styles.card} ${completed ? styles.cardDone : ""} ${ex.origin ? styles.cardAdhoc : ""}`}>
      <div className={styles.exHeader}>
        <button type="button" onClick={toggleCollapsed} className={styles.collapseBtn} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "▸" : "▾"}
        </button>
        <label className={styles.exName}>
          <input type="checkbox" checked={completed} onChange={(e) => onToggleComplete(ex.exerciseId, e.target.checked)} />
          <strong>{ex.exerciseName}</strong>
        </label>
        <ProvenanceBadge untagged={ex.untagged} />
        <span className={styles.tag}>cardio{ex.origin ? ` · ${ex.origin}` : ""}</span>
        {collapsed && entries.length > 0 && (
          <span className={styles.collapsedSummary}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        )}
        {!collapsed && onRemoveFromSession && (
          <button type="button" onClick={() => onRemoveFromSession(ex.exerciseId)} className={styles.secondaryBtn}>Remove</button>
        )}
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
  session, composition, completed, sessionSets, sessionCardio, pending, onConfirm, onClose,
}: {
  session: LocalSession;
  composition: CompositionItem[];
  completed: Set<string>;
  sessionSets: SessionSet[];
  sessionCardio: SessionCardio[];
  pending: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // One row per exercise that saw ANY activity in the session — sets, cardio, or
  // just a "done" check — regardless of whether it came from the program day,
  // another program, or an ad-hoc pick (bug 1b: cross-program/ad-hoc entries
  // were missing). Ordered by the session's composition order.
  const nameOf = (id: string, fallback?: string) =>
    composition.find((c) => c.exerciseId === id)?.exerciseName ?? fallback ?? id;
  const orderOf = (id: string) => {
    const i = composition.findIndex((c) => c.exerciseId === id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const rows = new Map<string, { name: string; sets: number; cardio: number; done: boolean }>();
  const bump = (id: string, name: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { name, sets: 0, cardio: 0, done: false }));
    return r;
  };
  for (const s of sessionSets) bump(s.exerciseId, s.exerciseName).sets += 1;
  for (const c of sessionCardio) bump(c.exerciseId, c.exerciseName).cardio += 1;
  for (const id of completed) bump(id, nameOf(id)).done = true;

  const list = Array.from(rows.entries())
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => orderOf(a.id) - orderOf(b.id));
  const setCount = sessionSets.length;
  const exerciseCount = list.length;

  function describe(r: { sets: number; cardio: number; done: boolean }): string {
    const bits: string[] = [];
    if (r.sets > 0) bits.push(`${r.sets} ${r.sets === 1 ? "set" : "sets"}`);
    if (r.cardio > 0) bits.push("cardio");
    if (bits.length === 0 && r.done) bits.push("done, no sets logged");
    return bits.join(" · ");
  }

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <h2 style={{ marginTop: 0 }}>Finish session — {session.origin}</h2>
        <p>
          <strong>{setCount}</strong> {setCount === 1 ? "set" : "sets"} across <strong>{exerciseCount}</strong>{" "}
          {exerciseCount === 1 ? "exercise" : "exercises"}
          {sessionCardio.length > 0 && <> · <strong>{sessionCardio.length}</strong> cardio {sessionCardio.length === 1 ? "entry" : "entries"}</>}.
        </p>
        {list.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Nothing logged yet — you can still finish, or keep logging.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {list.map((r) => <li key={r.id}>{r.name} — {describe(r)}</li>)}
          </ul>
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

export default function LogSessionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<LocalSession | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound">("loading");
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [blocks, setBlocks] = useState<BlockDetail[]>([]);
  const [sessionSets, setSessionSets] = useState<SessionSet[]>([]);
  const [sessionCardio, setSessionCardio] = useState<SessionCardio[]>([]);
  const [composition, setComposition] = useState<CompositionItem[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncError, setSyncError] = useState<"auth" | "network" | "server" | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [allPrograms, setAllPrograms] = useState<ProgramDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<number>>(new Set());
  const [selectedDayIds, setSelectedDayIds] = useState<Set<number>>(new Set());

  const refreshSession = useCallback(async () => {
    const [sets, cardio, comp, done, p] = await Promise.all([
      getSessionSets(sessionId), getSessionCardio(sessionId), getSessionComposition(sessionId),
      getCompletedExercises(sessionId), pendingCount(sessionId),
    ]);
    setSessionSets(sets);
    setSessionCardio(cardio);
    setComposition(comp);
    setCompleted(done);
    setPending(p);
  }, [sessionId]);

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
    setSyncError(r.authError ? "auth" : r.networkError ? "network" : r.serverError ? "server" : null);
    setSyncStatus(`Synced: +${r.created} ~${r.updated} −${r.deleted}${r.finished ? ` finish×${r.finished}` : ""}${r.failed ? `, ${r.failed} still pending` : ""}`);
    await refreshSession();
  }, [refreshSession]);

  const toggleComplete = useCallback(async (exerciseId: string, isComplete: boolean) => {
    await setExerciseCompleted(sessionId, exerciseId, isComplete);
    await refreshSession();
  }, [sessionId, refreshSession]);

  // Load the session: local first; if it only exists on the server, hydrate the
  // local store from it (needs connectivity, then works offline). Also pulls
  // machines/blocks/programs for the in-session "add" affordances.
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

      const [machinesRes, blocksRes] = await Promise.all([
        fetch("/api/machines").then((r) => (r.ok ? (r.json() as Promise<MachineOption[]>) : [])),
        fetch("/api/blocks").then((r) => (r.ok ? (r.json() as Promise<BlockDetail[]>) : [])),
      ]);
      if (cancelled) return;
      setMachines(machinesRes);
      setBlocks(blocksRes);

      const summaries = await fetch("/api/programs").then((r) => (r.ok ? r.json() : []));
      const full = await Promise.all(
        (summaries as { id: number }[]).map((p) =>
          fetch(`/api/programs/${p.id}`).then((r) => (r.ok ? (r.json() as Promise<ProgramDetail>) : null))
        )
      );
      if (!cancelled) setAllPrograms(full.filter((p): p is ProgramDetail => p !== null));
    })();
    // Re-drain when connectivity returns and when the tab regains focus — the
    // latter covers coming back from a re-login, so a pending outbox flushes
    // without a manual tap.
    const onFocus = () => { if (document.visibilityState === "visible") handleSync(); };
    window.addEventListener("online", handleSync);
    window.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleSync);
      window.removeEventListener("visibilitychange", onFocus);
    };
  }, [sessionId, handleSync, refreshSession]);

  // The session is self-contained: every card comes from its composition.
  const loggables: LoggableExercise[] = useMemo(() => {
    return composition.map((c) => ({
      key: `co:${c.exerciseId}`,
      exerciseId: c.exerciseId,
      exerciseName: c.exerciseName,
      loadType: c.loadType,
      portable: c.portable,
      conditioningOnly: c.conditioningOnly,
      target: c.targetSets != null ? { targetSets: c.targetSets, repRange: c.repRange, rirTarget: c.rirTarget } : null,
      params: c.params,
      origin: c.source,
      provenance: c.provenance,
      untagged: c.untagged,
    }));
  }, [composition]);

  function toggleId(set: Set<number>, id: number): Set<number> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function itemsFrom(exs: ProgramExerciseDetail[]): AttachExercise[] {
    return exs.map((e) => ({
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      loadType: e.loadType,
      portable: e.portable,
      conditioningOnly: e.conditioningOnly,
      provenance: e.source,
      untagged: e.untagged,
      targetSets: e.targetSets,
      repRange: e.repRange,
      rirTarget: e.rirTarget,
      params: e.params,
    }));
  }

  async function attachSelected() {
    for (const block of blocks) {
      if (selectedBlockIds.has(block.id)) {
        await attachToComposition(sessionId, itemsFrom(block.exercises), `block:${block.name}`);
      }
    }
    for (const prog of allPrograms) {
      for (const day of prog.days) {
        if (selectedDayIds.has(day.id)) {
          await attachToComposition(sessionId, itemsFrom(day.exercises), prettyDayName(day.name));
        }
      }
    }
    setSelectedBlockIds(new Set());
    setSelectedDayIds(new Set());
    setPickerOpen(false);
    await refreshSession();
  }

  async function addAdhocExercise(r: ExerciseSearchResult) {
    await attachToComposition(
      sessionId,
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
    await removeFromComposition(sessionId, exerciseId);
    await refreshSession();
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

      <h1>{session.origin} <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 16 }}>· {date}</span></h1>

      <div className={styles.addRow}>
        <button type="button" onClick={() => setPickerOpen((o) => !o)} className={styles.secondaryBtn}>
          {pickerOpen ? "Close" : "+ Add blocks / days to session"}
        </button>
        <span style={{ flex: "1 1 240px" }}>
          Or one exercise:
          <ExerciseSearch onPick={addAdhocExercise} placeholder="Search library / curated, or create custom…" />
        </span>
      </div>

      {pickerOpen && (
        <div className={styles.picker}>
          <p className={styles.pickerHint}>Pick any number of blocks or program days to add to this session.</p>
          {blocks.length > 0 && (
            <>
              <div className={styles.pickerGroup}>Blocks</div>
              {blocks.map((b) => (
                <label key={`b${b.id}`} className={styles.pickerRow}>
                  <input
                    type="checkbox"
                    checked={selectedBlockIds.has(b.id)}
                    onChange={() => setSelectedBlockIds((s) => toggleId(s, b.id))}
                  />
                  {b.name} <span className={styles.tag}>({b.exercises.length})</span>
                </label>
              ))}
            </>
          )}
          {allPrograms.map((prog) => (
            <div key={`p${prog.id}`}>
              <div className={styles.pickerGroup}>{prog.splitType}</div>
              {prog.days.map((d) => (
                <label key={`d${d.id}`} className={styles.pickerRow}>
                  <input
                    type="checkbox"
                    checked={selectedDayIds.has(d.id)}
                    onChange={() => setSelectedDayIds((s) => toggleId(s, d.id))}
                  />
                  {d.name} <span className={styles.tag}>({d.exercises.length})</span>
                </label>
              ))}
            </div>
          ))}
          <button
            type="button"
            onClick={attachSelected}
            disabled={selectedBlockIds.size === 0 && selectedDayIds.size === 0}
            className={styles.primary}
            style={{ marginTop: 8 }}
          >
            Attach selected ({selectedBlockIds.size + selectedDayIds.size})
          </button>
        </div>
      )}

      {loggables.length === 0 ? (
        <p style={{ opacity: 0.65 }}>Empty session — add a block, a program day, or a single exercise above to start logging.</p>
      ) : (
        <ul className={styles.list}>
          {loggables.map((ex) =>
            ex.conditioningOnly ? (
              <CardioCard
                key={ex.key}
                ex={ex}
                sessionId={sessionId}
                date={date}
                sessionCardio={sessionCardio}
                completed={completed.has(ex.exerciseId)}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
                onRemoveFromSession={removeFromSession}
              />
            ) : (
              <StrengthCard
                key={ex.key}
                ex={ex}
                sessionId={sessionId}
                date={date}
                machines={machines}
                sessionSets={sessionSets}
                completed={completed.has(ex.exerciseId)}
                onMachineAdded={refreshMachines}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
                onRemoveFromSession={removeFromSession}
              />
            )
          )}
        </ul>
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
          composition={composition}
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
