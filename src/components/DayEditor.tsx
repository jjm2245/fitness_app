"use client";

import { useState } from "react";

// Shared day/exercise editor used by both the program editor (/program) and the
// reusable-block editor (/blocks). A "block" is structurally a program_day, so
// the exact same CRUD routes and UI apply — `dayNoun` just relabels "day" vs
// "block" in the buttons.

export interface ProgramExerciseDetail {
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
}

export interface ProgramDayDetail {
  id: number;
  programId: number;
  name: string;
  orderIndex: number;
  exercises: ProgramExerciseDetail[];
}

export interface ExerciseOption {
  id: string;
  name: string;
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`${options?.method ?? "GET"} ${url} failed: ${res.status}`);
  return res.json();
}

function AddExerciseForm({ dayId, exercises, onAdded }: { dayId: number; exercises: ExerciseOption[]; onAdded: () => void }) {
  const [exerciseId, setExerciseId] = useState(exercises[0]?.id ?? "");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!exerciseId) return;
    await api(`/api/program-days/${dayId}/exercises`, {
      method: "POST",
      body: JSON.stringify({ exerciseId }),
    });
    onAdded();
  }

  return (
    <form onSubmit={handleAdd} style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
        {exercises.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.name}
          </option>
        ))}
      </select>
      <button type="submit">Add exercise</button>
    </form>
  );
}

function ProgramExerciseRow({ ex, onChanged }: { ex: ProgramExerciseDetail; onChanged: () => void }) {
  const [targetSets, setTargetSets] = useState(ex.targetSets);
  const [repRange, setRepRange] = useState(ex.repRange ?? "");
  const [rirTarget, setRirTarget] = useState(ex.rirTarget ?? "");

  async function save() {
    await api(`/api/program-exercises/${ex.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        targetSets,
        repRange: repRange === "" ? null : repRange,
        rirTarget: rirTarget === "" ? null : rirTarget,
      }),
    });
    onChanged();
  }

  async function remove() {
    await api(`/api/program-exercises/${ex.id}`, { method: "DELETE" });
    onChanged();
  }

  async function move(direction: "up" | "down") {
    await api(`/api/program-exercises/${ex.id}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
    onChanged();
  }

  return (
    <li style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "4px 0" }}>
      <button type="button" onClick={() => move("up")} aria-label="Move up">
        ↑
      </button>
      <button type="button" onClick={() => move("down")} aria-label="Move down">
        ↓
      </button>
      <strong style={{ minWidth: 160 }}>{ex.exerciseName}</strong>
      <input
        type="number"
        value={targetSets}
        onChange={(e) => setTargetSets(Number(e.target.value))}
        style={{ width: 48 }}
        title="Target sets"
      />
      <span>x</span>
      <input value={repRange} onChange={(e) => setRepRange(e.target.value)} placeholder="rep range" style={{ width: 70 }} />
      <span>@ RIR</span>
      <input value={rirTarget} onChange={(e) => setRirTarget(e.target.value)} style={{ width: 40 }} />
      <button type="button" onClick={save}>
        Save
      </button>
      <button type="button" onClick={remove}>
        Remove
      </button>
    </li>
  );
}

export function DayEditor({
  day,
  exercises,
  onChanged,
  dayNoun = "day",
}: {
  day: ProgramDayDetail;
  exercises: ExerciseOption[];
  onChanged: () => void;
  dayNoun?: string;
}) {
  const [name, setName] = useState(day.name);

  async function rename() {
    if (name.trim() === "" || name === day.name) return;
    await api(`/api/program-days/${day.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
    onChanged();
  }

  async function remove() {
    await api(`/api/program-days/${day.id}`, { method: "DELETE" });
    onChanged();
  }

  async function move(direction: "up" | "down") {
    await api(`/api/program-days/${day.id}/move`, { method: "POST", body: JSON.stringify({ direction }) });
    onChanged();
  }

  return (
    <section style={{ border: "1px solid #333", borderRadius: 6, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button type="button" onClick={() => move("up")} aria-label={`Move ${dayNoun} up`}>
          ↑
        </button>
        <button type="button" onClick={() => move("down")} aria-label={`Move ${dayNoun} down`}>
          ↓
        </button>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ fontWeight: "bold" }} />
        <button type="button" onClick={rename}>
          Rename
        </button>
        <button type="button" onClick={remove}>
          Delete {dayNoun}
        </button>
      </div>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
        {day.exercises.map((ex) => (
          <ProgramExerciseRow key={ex.id} ex={ex} onChanged={onChanged} />
        ))}
      </ul>

      <AddExerciseForm dayId={day.id} exercises={exercises} onAdded={onChanged} />
    </section>
  );
}
