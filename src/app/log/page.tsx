"use client";

import { useCallback, useEffect, useState } from "react";
import { queueSet, getPendingSets, flushQueue } from "@/lib/offlineQueue";

interface ExerciseOption {
  id: string;
  name: string;
  loadType: string;
  portable: boolean;
}

export default function LogPage() {
  const [exercises, setExercises] = useState<ExerciseOption[]>([]);
  const [exerciseId, setExerciseId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  const [load, setLoad] = useState(45);
  const [reps, setReps] = useState(8);
  const [rir, setRir] = useState(2);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState("");

  const refreshPendingCount = useCallback(async () => {
    const pending = await getPendingSets();
    setPendingCount(pending.length);
  }, []);

  const handleFlush = useCallback(async () => {
    const { synced, failed } = await flushQueue();
    setStatus(`Synced ${synced}, still pending ${failed}`);
    await refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [data, pending] = await Promise.all([
        fetch("/api/exercises").then((r) => r.json() as Promise<ExerciseOption[]>),
        getPendingSets(),
      ]);
      if (cancelled) return;
      setExercises(data);
      if (data.length > 0) setExerciseId(data[0].id);
      setPendingCount(pending.length);
    })();

    window.addEventListener("online", handleFlush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleFlush);
    };
  }, [handleFlush]);

  async function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    await queueSet({
      date: new Date().toISOString().slice(0, 10),
      exerciseId,
      machineId: machineId.trim() === "" ? null : machineId.trim(),
      setIndex: 1,
      setType,
      load,
      reps,
      rir,
    });
    await refreshPendingCount();
    setStatus("Queued locally.");
    void handleFlush();
  }

  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Log a set</h1>
      <p>Pending in offline queue: {pendingCount}</p>

      <form onSubmit={handleAddSet} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label>
          Exercise
          <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
            {exercises.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name} ({ex.loadType})
              </option>
            ))}
          </select>
        </label>

        <label>
          Machine ID (blank for portable free-weight/bodyweight)
          <input value={machineId} onChange={(e) => setMachineId(e.target.value)} />
        </label>

        <label>
          Set type
          <select value={setType} onChange={(e) => setSetType(e.target.value as "warmup" | "working")}>
            <option value="working">Working</option>
            <option value="warmup">Warm-up</option>
          </select>
        </label>

        <label>
          Load (lb)
          <input type="number" value={load} onChange={(e) => setLoad(Number(e.target.value))} />
        </label>

        <label>
          Reps
          <input type="number" value={reps} onChange={(e) => setReps(Number(e.target.value))} />
        </label>

        <label>
          RIR
          <input type="number" value={rir} onChange={(e) => setRir(Number(e.target.value))} />
        </label>

        <button type="submit">Add set</button>
      </form>

      <button onClick={handleFlush} style={{ marginTop: 12 }}>
        Sync now
      </button>

      <p>{status}</p>
    </main>
  );
}
