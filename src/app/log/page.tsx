"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  type SessionSet,
  type SessionMeta,
} from "@/lib/sessionStore";

interface ProgramExerciseDetail {
  id: number;
  dayId: number;
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

interface PreviousSession {
  date: string;
  sets: Array<{ load: number; reps: number; rir: number | null }>;
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

function formatPreviousSession(session: PreviousSession | null): string {
  if (!session) return "No previous session yet";
  const reps = session.sets.map((s) => `${s.reps}`).join(", ");
  const load = session.sets[0]?.load;
  return `Last time: ${load ?? "?"} × ${reps}`;
}

// One logged set: shows synced/pending state, inline edit + delete. All three
// operations go through the durable store, so they work offline — including
// correcting a set that already synced.
function LoggedSetRow({
  set,
  onChanged,
}: {
  set: SessionSet;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [load, setLoad] = useState(set.load);
  const [reps, setReps] = useState(set.reps);
  const [rir, setRir] = useState(set.rir ?? 0);

  const pending = set.syncState !== "synced";

  async function save() {
    if (reps < 1 || load < 0) return;
    await editSet(set.localId!, { load, reps, rir });
    setEditing(false);
    onChanged();
  }

  async function remove() {
    await deleteSet(set.localId!);
    onChanged();
  }

  if (editing) {
    return (
      <li style={{ display: "flex", gap: 4, alignItems: "center", margin: "3px 0", fontSize: 14 }}>
        <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 56 }} />
        <span>×</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 44 }} />
        <span>@</span>
        <input type="number" value={rir} onChange={(e) => setRir(Number(e.target.value))} style={{ width: 40 }} />
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </li>
    );
  }

  return (
    <li style={{ display: "flex", gap: 8, alignItems: "center", margin: "3px 0", fontSize: 14 }}>
      <span title={pending ? "Not yet synced" : "Synced"}>{pending ? "○" : "✓"}</span>
      <span>
        {set.setType === "warmup" ? "Warm-up" : "Working"}: {set.load} lb × {set.reps} @ RIR {set.rir ?? "—"}
      </span>
      <button type="button" onClick={() => setEditing(true)} style={{ fontSize: 12 }}>Edit</button>
      <button type="button" onClick={remove} style={{ fontSize: 12 }}>Delete</button>
    </li>
  );
}

function ExerciseCard({
  ex,
  machines,
  sessionSets,
  completed,
  onMachineAdded,
  onSessionChanged,
  onToggleComplete,
}: {
  ex: ProgramExerciseDetail;
  machines: MachineOption[];
  sessionSets: SessionSet[];
  completed: boolean;
  onMachineAdded: () => void;
  onSessionChanged: () => void;
  onToggleComplete: (exerciseId: string, completed: boolean) => void;
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
  const [load, setLoad] = useState(45);
  const [reps, setReps] = useState(8);
  const [rir, setRir] = useState(Number(ex.rirTarget ?? 2));
  const [error, setError] = useState<string | null>(null);

  const [previousSession, setPreviousSession] = useState<PreviousSession | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);

  const resolvedMachineId = activeExercise.portable ? null : machineId.trim() || null;
  const loggedSets = sessionSets.filter((s) => s.exerciseId === activeExercise.id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (resolvedMachineId) params.set("machineId", resolvedMachineId);
      const res = await fetch(`/api/exercises/${activeExercise.id}/last-session?${params.toString()}`);
      const data: { session: PreviousSession | null } = await res.json();
      if (!cancelled) setPreviousSession(data.session);
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
        repRangeMax: String(parseRepRangeMax(ex.repRange)),
        targetRir: String(ex.rirTarget ?? 2),
      });
      if (resolvedMachineId) params.set("machineId", resolvedMachineId);
      const res = await fetch(`/api/progression?${params.toString()}`);
      const data: ProgressionResult = await res.json();
      setProgression(data);
    } finally {
      setChecking(false);
    }
  }, [activeExercise.id, ex.repRange, ex.rirTarget, resolvedMachineId]);

  async function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(reps) || reps < 1) {
      setError("Reps must be at least 1.");
      return;
    }
    if (!Number.isFinite(load) || load < 0) {
      setError("Load can't be negative.");
      return;
    }
    setError(null);

    await logSet({
      date: todayIso(),
      exerciseId: activeExercise.id, // the exercise actually performed (post-swap)
      exerciseName: activeExercise.name,
      machineId: resolvedMachineId,
      setType,
      load,
      reps,
      rir,
    });

    if (resolvedMachineId) {
      localStorage.setItem(lastMachineKey(activeExercise.id), resolvedMachineId);
    }
    onSessionChanged();
  }

  async function openSwap() {
    setSwapOpen((open) => !open);
    if (swapCandidates || swapLoading) return;
    setSwapLoading(true);
    try {
      const res = await fetch(`/api/substitutions?exerciseId=${encodeURIComponent(ex.exerciseId)}`);
      const data: SubstitutionCandidate[] = await res.json();
      setSwapCandidates(data);
    } finally {
      setSwapLoading(false);
    }
  }

  function pickSwap(candidate: SubstitutionCandidate) {
    setActiveExercise({
      id: candidate.id,
      name: candidate.name,
      loadType: candidate.loadType,
      portable: candidate.portable,
    });
    setMachineId(candidate.portable ? "" : localStorage.getItem(lastMachineKey(candidate.id)) ?? "");
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
    setMachineId(name); // optimistic — works offline; set-logs auto-registers on sync
    setNewMachineName("");
    try {
      const res = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: name }),
      });
      if (res.ok) onMachineAdded();
    } catch {
      // offline — fine, /api/set-logs auto-registers the machine when it syncs
    }
  }

  // Conditioning (cardio) has no strength-log shape yet — Part 3 adds it.
  if (ex.conditioningOnly) {
    return (
      <li style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #333" }}>
        <strong>{ex.exerciseName}</strong> — conditioning
        {ex.params ? <span style={{ opacity: 0.6 }}> ({JSON.stringify(ex.params)})</span> : null}
      </li>
    );
  }

  return (
    <li
      style={{
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: "1px solid #333",
        opacity: completed ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => onToggleComplete(ex.exerciseId, e.target.checked)}
            title="Mark exercise done"
          />
          <strong>{activeExercise.name}</strong>
        </label>
        {activeExercise.id !== ex.exerciseId && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            (swapped from {ex.exerciseName} —{" "}
            <button type="button" onClick={resetSwap} style={{ fontSize: 12 }}>
              reset
            </button>
            )
          </span>
        )}
        <span
          style={{ fontSize: 12, opacity: 0.6, border: "1px solid #444", borderRadius: 999, padding: "1px 8px" }}
        >
          target: {ex.targetSets} × {ex.repRange ?? "?"} @ RIR {ex.rirTarget ?? "?"}
        </span>
        <button type="button" onClick={openSwap} style={{ fontSize: 12 }}>
          Swap
        </button>
      </div>

      <p style={{ fontSize: 13, opacity: 0.8, margin: "4px 0" }}>{formatPreviousSession(previousSession)}</p>

      {swapOpen && (
        <div style={{ fontSize: 13, border: "1px solid #333", borderRadius: 6, padding: 8, margin: "6px 0" }}>
          <p style={{ opacity: 0.7, margin: 0 }}>
            Deterministic candidates — same movement pattern, overlapping muscles, preserves weekly stimulus (not
            the load number).
          </p>
          {swapLoading && <p>Loading…</p>}
          {swapCandidates?.length === 0 && <p>No candidates available right now.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {swapCandidates?.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pickSwap(c)}>
                  {c.name}
                </button>{" "}
                <span style={{ opacity: 0.6 }}>({c.loadType})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!activeExercise.portable && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Machine{" "}
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">(none selected)</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
          <input
            value={newMachineName}
            onChange={(e) => setNewMachineName(e.target.value)}
            placeholder="new machine id"
            style={{ width: 130 }}
          />
          <button type="button" onClick={addMachine}>
            + Add
          </button>
        </div>
      )}

      <form onSubmit={handleAddSet} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
        <select value={setType} onChange={(e) => setSetType(e.target.value as "warmup" | "working")}>
          <option value="working">Working</option>
          <option value="warmup">Warm-up</option>
        </select>
        <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 64 }} title="Load" />
        <span>lb ×</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 48 }} title="Reps" />
        <span>reps @ RIR</span>
        <input type="number" value={rir} onChange={(e) => setRir(Number(e.target.value))} style={{ width: 48 }} title="RIR" />
        <button type="submit">Add set</button>
      </form>
      {error && <p style={{ color: "#f66", fontSize: 13, margin: "2px 0" }}>{error}</p>}

      {loggedSets.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "4px 0" }}>
          {loggedSets.map((s) => (
            <LoggedSetRow key={s.localId} set={s} onChanged={onSessionChanged} />
          ))}
        </ul>
      )}

      <button type="button" onClick={checkProgression} disabled={checking} style={{ fontSize: 13 }}>
        {checking ? "Checking…" : "Check progression"}
      </button>

      {progression && (
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
          {progression.status === "new_machine_baseline" ? (
            <p>New machine — re-baselining, not a stall: {progression.reason}</p>
          ) : (
            <>
              <p>
                {progression.signal.type}
                {"reason" in progression.signal ? `: ${progression.signal.reason}` : ""}
                {progression.signal.type === "increase_load" && progression.signal.suggestedLoad != null
                  ? ` (try ${progression.signal.suggestedLoad} lb)`
                  : ""}
              </p>
              {progression.intervention && <p>Stall-buster: {progression.intervention.message}</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function FinishSummary({
  date,
  sessionSets,
  dayExerciseCount,
  meta,
  pending,
  onConfirm,
  onClose,
}: {
  date: string;
  sessionSets: SessionSet[];
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
  const exerciseCount = byExercise.size;
  const setCount = sessionSets.length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{ background: "#111", border: "1px solid #444", borderRadius: 10, padding: 20, maxWidth: 420, width: "100%" }}>
        <h2 style={{ marginTop: 0 }}>Finish session — {date}</h2>
        <p>
          <strong>{setCount}</strong> {setCount === 1 ? "set" : "sets"} logged across{" "}
          <strong>{exerciseCount}</strong> of {dayExerciseCount} program {dayExerciseCount === 1 ? "exercise" : "exercises"}.
        </p>
        {exerciseCount === 0 ? (
          <p style={{ opacity: 0.7 }}>Nothing logged yet — you can still finish, or keep logging.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {Array.from(byExercise.values()).map((e) => (
              <li key={e.name}>
                {e.name} — {e.count} {e.count === 1 ? "set" : "sets"}
              </li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          {pending > 0 ? `${pending} change(s) not yet synced — they'll sync when you're back online.` : "All changes synced."}
        </p>
        {meta?.finishedAt && (
          <p style={{ fontSize: 13, opacity: 0.7 }}>
            Previously finished at {new Date(meta.finishedAt).toLocaleTimeString()} — finishing again re-stamps it.
          </p>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button type="button" onClick={onConfirm} style={{ fontWeight: "bold" }}>
            Confirm finish
          </button>
          <button type="button" onClick={onClose}>
            Keep logging
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LogPage() {
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [sessionSets, setSessionSets] = useState<SessionSet[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [pending, setPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const [showFinish, setShowFinish] = useState(false);

  const date = todayIso();

  const refreshSession = useCallback(async () => {
    const [sets, done, m, p] = await Promise.all([
      getSessionSets(date),
      getCompletedExercises(date),
      getSessionMeta(date),
      pendingCount(date),
    ]);
    setSessionSets(sets);
    setCompleted(done);
    setMeta(m);
    setPending(p);
  }, [date]);

  const refreshMachines = useCallback(async () => {
    const res = await fetch("/api/machines");
    if (res.ok) setMachines(await res.json());
  }, []);

  // Log/edit/delete write to the durable store first (instant, offline-safe),
  // then we refresh the UI from the store and fire a best-effort sync, then
  // refresh again so the pending/synced indicators settle.
  const onSessionChanged = useCallback(async () => {
    await refreshSession();
    await sync().catch(() => {});
    await refreshSession();
  }, [refreshSession]);

  const handleSync = useCallback(async () => {
    const r = await sync();
    setSyncStatus(
      `Synced: +${r.created} ~${r.updated} −${r.deleted}${r.finished ? ` finish×${r.finished}` : ""}${
        r.failed ? `, ${r.failed} still pending` : ""
      }`
    );
    await refreshSession();
  }, [refreshSession]);

  const toggleComplete = useCallback(
    async (exerciseId: string, isComplete: boolean) => {
      await setExerciseCompleted(date, exerciseId, isComplete);
      await refreshSession();
    },
    [date, refreshSession]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [programRes, machinesRes] = await Promise.all([
        fetch("/api/program").then((r) => (r.ok ? (r.json() as Promise<ProgramDetail>) : null)),
        fetch("/api/machines").then((r) => (r.ok ? (r.json() as Promise<MachineOption[]>) : [])),
      ]);
      if (cancelled) return;
      setProgram(programRes);
      if (programRes && programRes.days.length > 0) setSelectedDayId(programRes.days[0].id);
      setMachines(machinesRes);
      await refreshSession();
    })();

    window.addEventListener("online", handleSync);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleSync);
    };
  }, [handleSync, refreshSession]);

  const currentDay = useMemo(
    () => program?.days.find((d) => d.id === selectedDayId) ?? null,
    [program, selectedDayId]
  );

  async function confirmFinish() {
    await finishSession(date);
    setShowFinish(false);
    await onSessionChanged();
    setSyncStatus("Session finished.");
  }

  const strengthExerciseCount = currentDay?.exercises.filter((e) => !e.conditioningOnly).length ?? 0;

  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "sans-serif", paddingBottom: 80 }}>
      <h1>Log a session</h1>
      <p style={{ fontSize: 14 }}>
        {pending > 0 ? `${pending} change(s) pending sync` : "All changes synced"}{" "}
        <button onClick={handleSync} style={{ marginLeft: 8 }}>
          Sync now
        </button>
        {meta?.finishedAt && <span style={{ marginLeft: 8, opacity: 0.7 }}>· finished {new Date(meta.finishedAt).toLocaleTimeString()}</span>}
      </p>
      {syncStatus && <p style={{ fontSize: 13, opacity: 0.8 }}>{syncStatus}</p>}

      {!program ? (
        <p>
          No active program found. Visit <Link href="/program">/program</Link> to create one, or run `npm run
          db:seed`.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {program.days.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDayId(d.id)}
                style={{ fontWeight: d.id === selectedDayId ? "bold" : "normal" }}
              >
                {d.name}
              </button>
            ))}
          </div>

          <ul style={{ listStyle: "none", padding: 0 }}>
            {currentDay?.exercises.map((ex) => (
              <ExerciseCard
                key={ex.id}
                ex={ex}
                machines={machines}
                sessionSets={sessionSets}
                completed={completed.has(ex.exerciseId)}
                onMachineAdded={refreshMachines}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
              />
            ))}
          </ul>
        </>
      )}

      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: 12,
          background: "#0a0a0a",
          borderTop: "1px solid #333",
          display: "flex",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Link href="/program">Edit program</Link>
        <button type="button" onClick={() => setShowFinish(true)} style={{ fontWeight: "bold" }}>
          Finish session ({sessionSets.length})
        </button>
      </div>

      {showFinish && (
        <FinishSummary
          date={date}
          sessionSets={sessionSets}
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
