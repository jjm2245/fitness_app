"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { queueSet, getPendingSets, flushQueue } from "@/lib/offlineQueue";

interface ProgramExerciseRow {
  day: string;
  orderIndex: number;
  targetSets: number;
  repRange: string | null;
  rirTarget: string | null;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  params: Record<string, unknown> | null;
}

interface ProgramResponse {
  programId: number;
  splitType: string;
  days: Array<{ day: string; exercises: ProgramExerciseRow[] }>;
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

function ExerciseCard({ ex, onLogged }: { ex: ProgramExerciseRow; onLogged: () => void }) {
  // Lazy-initialized from localStorage (spec §16: "same as last time?" machine
  // recall) instead of an effect, since it's a synchronous read with no
  // subscription to keep alive.
  const [machineId, setMachineId] = useState(() => {
    if (ex.portable || typeof window === "undefined") return "";
    return localStorage.getItem(lastMachineKey(ex.exerciseId)) ?? "";
  });
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  const [load, setLoad] = useState(45);
  const [reps, setReps] = useState(8);
  const [rir, setRir] = useState(Number(ex.rirTarget ?? 2));
  const [loggedToday, setLoggedToday] = useState<LoggedSet[]>([]);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);

  const checkProgression = useCallback(async () => {
    setChecking(true);
    try {
      const params = new URLSearchParams({
        exerciseId: ex.exerciseId,
        repRangeMax: String(parseRepRangeMax(ex.repRange)),
        targetRir: String(ex.rirTarget ?? 2),
      });
      if (!ex.portable && machineId.trim()) params.set("machineId", machineId.trim());
      const res = await fetch(`/api/progression?${params.toString()}`);
      const data: ProgressionResult = await res.json();
      setProgression(data);
    } finally {
      setChecking(false);
    }
  }, [ex.exerciseId, ex.repRange, ex.rirTarget, ex.portable, machineId]);

  async function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    const resolvedMachineId = ex.portable ? null : machineId.trim() || null;

    await queueSet({
      date: new Date().toISOString().slice(0, 10),
      exerciseId: ex.exerciseId,
      machineId: resolvedMachineId,
      setIndex: loggedToday.length + 1,
      setType,
      load,
      reps,
      rir,
    });

    if (resolvedMachineId) {
      localStorage.setItem(lastMachineKey(ex.exerciseId), resolvedMachineId);
    }

    setLoggedToday((prev) => [...prev, { setType, load, reps, rir }]);
    onLogged();
    await flushQueue();
    onLogged(); // refresh the pending count again now that the sync attempt is done
    void checkProgression();
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
      <strong>{ex.exerciseName}</strong>{" "}
      <span style={{ opacity: 0.7 }}>
        ({ex.targetSets} x {ex.repRange ?? "?"} @ RIR {ex.rirTarget ?? "?"})
      </span>

      {!ex.portable && (
        <div>
          <label>
            Machine ID{" "}
            <input value={machineId} onChange={(e) => setMachineId(e.target.value)} placeholder="e.g. pf_legext_1" />
          </label>
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
  const [program, setProgram] = useState<ProgramResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");

  const refreshPendingCount = useCallback(async () => {
    const pending = await getPendingSets();
    setPendingCount(pending.length);
  }, []);

  const handleFlush = useCallback(async () => {
    const { synced, failed } = await flushQueue();
    setSyncStatus(`Synced ${synced}, still pending ${failed}`);
    await refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [programRes, pending] = await Promise.all([
        fetch("/api/program").then((r) => (r.ok ? (r.json() as Promise<ProgramResponse>) : null)),
        getPendingSets(),
      ]);
      if (cancelled) return;
      setProgram(programRes);
      if (programRes && programRes.days.length > 0) setSelectedDay(programRes.days[0].day);
      setPendingCount(pending.length);
    })();

    window.addEventListener("online", handleFlush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleFlush);
    };
  }, [handleFlush]);

  const currentDayExercises = useMemo(
    () => program?.days.find((d) => d.day === selectedDay)?.exercises ?? [],
    [program, selectedDay]
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
        <p>No active program found. Run `npm run db:seed` to create the default program.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {program.days.map((d) => (
              <button
                key={d.day}
                onClick={() => setSelectedDay(d.day)}
                style={{ fontWeight: d.day === selectedDay ? "bold" : "normal" }}
              >
                {d.day}
              </button>
            ))}
          </div>

          <ul style={{ listStyle: "none", padding: 0 }}>
            {currentDayExercises.map((ex) => (
              <ExerciseCard key={ex.exerciseId} ex={ex} onLogged={refreshPendingCount} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
