"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getCompletedInstances,
  setOccurrenceCompleted,
  getSession,
  hydrateFromServer,
  finishSession,
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
interface MachineOption {
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
function lastMachineKey(exerciseId: string) {
  return `fitness-app:last-machine:${exerciseId}`;
}
// The neutral default: "I'm using a machine but haven't said which" — distinct
// from "No machine" (which asserts free/portable). Both resolve to a null
// machineId (the portable/free progression lane), so this is a labelling choice
// only and never splits an exercise's history — the core is untouched. A sentinel
// (not "") so we can tell it apart from an explicit "No machine" in the UI.
const UNSPECIFIED_MACHINE = "__unspecified__";
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
// Accepts "1:55" or plain seconds ("115"). Null when unparseable.
function parseRest(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const mmss = t.match(/^(\d+):([0-5]?\d)$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// The rest chip: shows the value with its honesty tag (est/timed/you/unknown) and
// is tappable to correct — a corrected value becomes source "user".
function RestChip({ set, onChanged }: { set: SessionSet; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const label =
    set.restSeconds != null
      ? set.restSource === "derived"
        ? `rest ~${fmtRest(set.restSeconds)} · est`
        : set.restSource === "timed"
        ? `rest ${fmtRest(set.restSeconds)} · timed`
        : `rest ${fmtRest(set.restSeconds)}`
      : "rest —";

  async function save() {
    const secs = parseRest(text);
    if (secs == null) return setEditing(false);
    await editSet(set.localId!, { restSeconds: secs, restSource: "user" });
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
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
      onClick={() => { setText(set.restSeconds != null ? fmtRest(set.restSeconds) : ""); setEditing(true); }}
    >
      {label}
    </button>
  );
}

function LoggedSetRow({ set, isDrop, onChanged, onDrop }: { set: SessionSet; isDrop: boolean; onChanged: () => void; onDrop: (parent: SessionSet) => void }) {
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
      <li style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "3px 0", fontSize: 14, paddingLeft: isDrop ? 22 : 0 }}>
        <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 56 }} />
        <span>×</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 44 }} />
        <EffortPicker value={effort} onChange={setEffort} />
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </li>
    );
  }
  const sideTag = set.side === "left" ? " · L" : set.side === "right" ? " · R" : set.side === "both" ? " · L+R" : "";
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
      {!isDrop && <RestChip set={set} onChanged={onChanged} />}
      <button type="button" onClick={() => setEditing(true)} className={styles.secondaryBtn}>Edit</button>
      <button type="button" onClick={remove} className={styles.secondaryBtn}>Delete</button>
      <button type="button" onClick={() => onDrop(set)} className={styles.secondaryBtn} title="Add a drop-set segment under this set">+ Drop</button>
    </li>
  );
}

// Tap-to-start rest timer (a feature, not a chore): counts up after racking; the
// NEXT set you log consumes the elapsed time as an exact, source="timed" rest.
// Optional target fires a notification (permission-gated). Never required —
// derivation covers untimed rests. Pure client state → works offline.
function RestTimer({ timerRef }: { timerRef: React.MutableRefObject<number | null> }) {
  // The shared ref is the source of truth (consumed by logSet via takeTimedRest);
  // this state is a per-second mirror of it for display only — refs are never
  // read during render.
  const [view, setView] = useState<{ running: boolean; elapsed: number }>({ running: false, elapsed: 0 });
  const [targetMin, setTargetMin] = useState("");
  const notifyAt = useRef<number | null>(null);
  const notified = useRef(false);

  useEffect(() => {
    const iv = setInterval(() => {
      const start = timerRef.current;
      setView(start != null ? { running: true, elapsed: Math.floor((Date.now() - start) / 1000) } : { running: false, elapsed: 0 });
      if (start != null && notifyAt.current != null && !notified.current && Date.now() >= notifyAt.current) {
        notified.current = true;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Rest done — next set");
        }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [timerRef]);

  function toggle() {
    if (timerRef.current != null) {
      timerRef.current = null; // cancelled — nothing recorded
      notifyAt.current = null;
      setView({ running: false, elapsed: 0 });
    } else {
      timerRef.current = Date.now();
      notified.current = false;
      const mins = Number(targetMin);
      notifyAt.current = Number.isFinite(mins) && mins > 0 ? Date.now() + mins * 60_000 : null;
      if (notifyAt.current && typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      setView({ running: true, elapsed: 0 });
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
      <button type="button" onClick={toggle} className={styles.secondaryBtn} title="Start after racking; the next set you log records this as its exact rest">
        {view.running ? `⏱ ${fmtRest(view.elapsed)} · cancel` : "⏱ Rest timer"}
      </button>
      {!view.running && (
        <input
          type="number"
          value={targetMin}
          onChange={(e) => setTargetMin(e.target.value)}
          placeholder="min"
          title="Optional target — notifies when your rest is up"
          style={{ width: 44, fontSize: 12 }}
        />
      )}
    </span>
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
  takeTimedRest,
}: {
  ex: LoggableOccurrence;
  sessionId: string;
  date: string;
  controls: CardControls;
  sessionSets: SessionSet[];
  completed: boolean;
  onSessionChanged: () => void;
  onToggleComplete: (instanceId: string, completed: boolean) => void;
  takeTimedRest: () => number | null;
}) {
  const [activeExercise, setActiveExercise] = useState({
    id: ex.exerciseId,
    name: ex.exerciseName,
    loadType: ex.loadType,
    portable: ex.portable,
    unilateral: ex.unilateral,
  });
  // Machines curated for THIS exercise (Part 3c), not the global list.
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const refreshMachines = useCallback(async () => {
    const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/machines`);
    if (res.ok) setMachines(await res.json());
  }, [activeExercise.id]);
  const [machineId, setMachineId] = useState(() => {
    // Default to "Unspecified machine" unless a named machine was last used here.
    if (typeof window === "undefined") return UNSPECIFIED_MACHINE;
    return localStorage.getItem(lastMachineKey(ex.exerciseId)) ?? UNSPECIFIED_MACHINE;
  });
  const [newMachineName, setNewMachineName] = useState("");
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  const [load, setLoad] = useState(ex.loadType === "bodyweight" ? 0 : 45);
  const [reps, setReps] = useState(8);
  const [effort, setEffort] = useState<EffortTag | null>(null);
  // True loads (3a): effective load = entered + a known additive offset. The
  // offset comes from the selected machine's built-in weight, or — with no
  // machine — an optional manual "+ bar/built-in" field. Shown transparently.
  const [manualOffset, setManualOffset] = useState("");
  // Unilateral side (Part 4): recorded per set; auto-alternates L→R after
  // logging (tap to override; "both" stays put).
  const [side, setSide] = useState<SetSide>("left");
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });

  // The machine field is always shown now — we never infer which exercises
  // "should" have a machine (a dumbbell move can still be done on a machine at a
  // different gym, etc.). Both "Unspecified machine" (the neutral default) and
  // "No machine" resolve to null = the portable/free lane; any label = a
  // context-bound machine. This is purely data-entry: the per-machine
  // progression semantics (null = portable, never re-baselined; named =
  // re-baseline on change) are unchanged — they key off this same null.
  const resolvedMachineId =
    machineId === "" || machineId === UNSPECIFIED_MACHINE ? null : machineId;
  const selectedMachine = resolvedMachineId ? machines.find((m) => m.id === resolvedMachineId) ?? null : null;
  // The additive offset applied to this set's effective load (3a): the selected
  // machine's stored built-in weight, else the optional manual field. Additive
  // numerical weight only — pulley ratios etc. stay descriptive, never folded in.
  const machineOffset = selectedMachine?.builtInWeight != null ? Number(selectedMachine.builtInWeight) : 0;
  const manualOffsetNum = !selectedMachine && manualOffset.trim() !== "" ? Number(manualOffset) : 0;
  const effOffset = Number.isFinite(machineOffset) && machineOffset !== 0 ? machineOffset : Number.isFinite(manualOffsetNum) ? manualOffsetNum : 0;
  const totalLoad = load + effOffset;
  // Sets for THIS occurrence only (repeats keep separate set lists).
  const loggedSets = sessionSets.filter((s) => s.instanceId === ex.instanceId);

  // Load this exercise's curated machine list (always — the field is always on).
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/machines`);
      if (res.ok) setMachines(await res.json());
    })();
  }, [activeExercise.id]);

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
      instanceId: ex.instanceId,
      date,
      exerciseId: activeExercise.id,
      exerciseName: activeExercise.name,
      machineId: resolvedMachineId,
      machineLabel: selectedMachine?.label ?? null,
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
    if (resolvedMachineId) localStorage.setItem(lastMachineKey(activeExercise.id), resolvedMachineId);
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
      machineId: dropFor.machineId,
      machineLabel: dropFor.machineLabel ?? null,
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
    setMachineId(localStorage.getItem(lastMachineKey(c.id)) ?? UNSPECIFIED_MACHINE);
    setSwapOpen(false);
  }
  function resetSwap() {
    setActiveExercise({ id: ex.exerciseId, name: ex.exerciseName, loadType: ex.loadType, portable: ex.portable, unilateral: ex.unilateral });
    setMachineId(localStorage.getItem(lastMachineKey(ex.exerciseId)) ?? UNSPECIFIED_MACHINE);
    setSwapOpen(false);
  }
  async function addMachine() {
    const name = newMachineName.trim();
    if (!name) return;
    // Surrogate-key model: the client owns identity (uuid); the label is display
    // only. Optimistically add locally so it's selected even offline; the set
    // POST auto-registers id+label on sync if this POST never lands.
    const newIdVal = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m_${Date.now().toString(36)}`;
    setMachines((ms) => [...ms, { id: newIdVal, label: name, builtInWeight: null, notes: null }]);
    setMachineId(newIdVal);
    setNewMachineName("");
    try {
      // Curate it under this exercise (Part 3c), so it's in the list next time.
      const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/machines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newIdVal, label: name }),
      });
      if (res.ok) refreshMachines();
    } catch {
      /* offline — set-logs auto-registers + associates on sync */
    }
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
        <label title="'Unspecified machine' (the default) just means you're on a machine but haven't labelled which — same tracking as free/portable. 'No machine' is the free/portable lane (dumbbells, barbell, bodyweight). Only name a machine if there are two of the same, or you're at a different gym.">
          Machine{" "}
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value={UNSPECIFIED_MACHINE}>Unspecified machine</option>
            <option value="">No machine</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.label}{m.builtInWeight != null ? ` (+${Number(m.builtInWeight)} built-in)` : ""}</option>)}
          </select>
        </label>
        <input value={newMachineName} onChange={(e) => setNewMachineName(e.target.value)} placeholder='label it, e.g. "leg ext by the mirror"' style={{ width: 200 }} />
        <button type="button" onClick={addMachine}>+ Add</button>
        {!selectedMachine && (
          <label style={{ fontSize: 13, opacity: 0.85 }} title="Optional constant added weight (bar, fixed handle) applied to every set's effective load">
            + bar/built-in{" "}
            <input type="number" value={manualOffset} onChange={(e) => setManualOffset(e.target.value)} placeholder="lb" style={{ width: 48 }} />
          </label>
        )}
      </div>

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
                {s === "left" ? "L" : s === "right" ? "R" : "L+R"}
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
          {displaySets.map(({ set: s, isDrop }) => (
            <LoggedSetRow key={s.localId} set={s} isDrop={isDrop} onChanged={onSessionChanged} onDrop={startDrop} />
          ))}
        </ul>
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

  // Rest timer (shared across cards): started by RestTimer, consumed exactly once
  // by whichever set is logged next — that set's rest becomes source "timed".
  const restTimerRef = useRef<number | null>(null);
  const takeTimedRest = useCallback((): number | null => {
    if (restTimerRef.current == null) return null;
    const secs = (Date.now() - restTimerRef.current) / 1000;
    restTimerRef.current = null; // consumed; tap again after racking
    return secs;
  }, []);

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

      <h1>{session.origin} <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 16 }}>· {date}</span></h1>

      <div className={styles.addRow}>
        <button type="button" onClick={() => setPaletteOpen((o) => !o)} className={styles.primary}>
          {paletteOpen ? "Hide add panel" : "+ Add exercise"}
        </button>
        <RestTimer timerRef={restTimerRef} />
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
                takeTimedRest={takeTimedRest}
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
