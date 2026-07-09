"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { queueSet, getPendingSets, flushQueue } from "@/lib/offlineQueue";

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

interface LoggedSet {
  setType: "warmup" | "working";
  load: number;
  reps: number;
  rir: number | null;
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
  const parts = session.sets.map((s) => `${s.reps}`).join(", ");
  const load = session.sets[0]?.load;
  return `Last time: ${load ?? "?"} x ${parts}`;
}

function ExerciseCard({
  ex,
  machines,
  onMachineAdded,
  onLogged,
}: {
  ex: ProgramExerciseDetail;
  machines: MachineOption[];
  onMachineAdded: () => void;
  onLogged: () => void;
}) {
  // The exercise actually being logged this session — starts as the program's
  // prescribed exercise, can change via "Swap". The program itself is never
  // touched; this is purely a client-side substitution for today (spec §8:
  // "a short parallel track").
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
  const [loggedToday, setLoggedToday] = useState<LoggedSet[]>([]);

  const [previousSession, setPreviousSession] = useState<PreviousSession | null>(null);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);

  const resolvedMachineId = activeExercise.portable ? null : machineId.trim() || null;

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

    await queueSet({
      date: new Date().toISOString().slice(0, 10),
      exerciseId: activeExercise.id, // the exercise actually performed, not necessarily ex.exerciseId
      machineId: resolvedMachineId,
      setIndex: loggedToday.length + 1,
      setType,
      load,
      reps,
      rir,
    });

    if (resolvedMachineId) {
      localStorage.setItem(lastMachineKey(activeExercise.id), resolvedMachineId);
    }

    setLoggedToday((prev) => [...prev, { setType, load, reps, rir }]);
    onLogged();
    await flushQueue();
    onLogged();
    void checkProgression();
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
    setMachineId(name); // optimistic — works even offline, since set-logs auto-registers on sync
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

  if (ex.conditioningOnly) {
    return (
      <li style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #333" }}>
        <strong>{ex.exerciseName}</strong> — conditioning
        {ex.params ? <span> ({JSON.stringify(ex.params)})</span> : null}
      </li>
    );
  }

  return (
    <li style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #333" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong>{activeExercise.name}</strong>
        {activeExercise.id !== ex.exerciseId && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            (swapped from {ex.exerciseName} —{" "}
            <button type="button" onClick={resetSwap} style={{ fontSize: 12 }}>
              reset
            </button>
            )
          </span>
        )}
        {/* Guideline chip, never enforced — the program's target for this slot. */}
        <span
          style={{
            fontSize: 12,
            opacity: 0.6,
            border: "1px solid #444",
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          target: {ex.targetSets} x {ex.repRange ?? "?"} @ RIR {ex.rirTarget ?? "?"}
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
        <span>lb x</span>
        <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 48 }} title="Reps" />
        <span>reps @ RIR</span>
        <input type="number" value={rir} onChange={(e) => setRir(Number(e.target.value))} style={{ width: 48 }} title="RIR" />
        <button type="submit">Add set</button>
      </form>

      {loggedToday.length > 0 && (
        <ul style={{ fontSize: 14, opacity: 0.85 }}>
          {loggedToday.map((s, i) => (
            <li key={i}>
              {s.setType === "warmup" ? "Warm-up" : "Working"}: {s.load} lb x {s.reps} @ RIR {s.rir}
            </li>
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

export default function LogPage() {
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");

  const refreshPendingCount = useCallback(async () => {
    const pending = await getPendingSets();
    setPendingCount(pending.length);
  }, []);

  const refreshMachines = useCallback(async () => {
    const res = await fetch("/api/machines");
    if (res.ok) setMachines(await res.json());
  }, []);

  const handleFlush = useCallback(async () => {
    const { synced, failed } = await flushQueue();
    setSyncStatus(`Synced ${synced}, still pending ${failed}`);
    await refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [programRes, pending, machinesRes] = await Promise.all([
        fetch("/api/program").then((r) => (r.ok ? (r.json() as Promise<ProgramDetail>) : null)),
        getPendingSets(),
        fetch("/api/machines").then((r) => (r.ok ? (r.json() as Promise<MachineOption[]>) : [])),
      ]);
      if (cancelled) return;
      setProgram(programRes);
      if (programRes && programRes.days.length > 0) setSelectedDayId(programRes.days[0].id);
      setPendingCount(pending.length);
      setMachines(machinesRes);
    })();

    window.addEventListener("online", handleFlush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleFlush);
    };
  }, [handleFlush]);

  const currentDay = useMemo(
    () => program?.days.find((d) => d.id === selectedDayId) ?? null,
    [program, selectedDayId]
  );

  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Log a session</h1>
      <p>
        Offline queue pending: {pendingCount}{" "}
        <button onClick={handleFlush} style={{ marginLeft: 8 }}>
          Sync now
        </button>
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
                onMachineAdded={refreshMachines}
                onLogged={refreshPendingCount}
              />
            ))}
          </ul>
        </>
      )}

      <p>
        <Link href="/program">Edit program</Link>
      </p>
    </main>
  );
}
