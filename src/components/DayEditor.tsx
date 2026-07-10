"use client";

import { useState } from "react";
import styles from "./DayEditor.module.css";

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
    <form onSubmit={handleAdd} className={styles.inlineForm} style={{ marginTop: 8 }}>
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
    <li className={styles.exRow}>
      <strong className={styles.exName}>{ex.exerciseName}</strong>
      <button type="button" onClick={() => move("up")} aria-label="Move up" className={styles.iconBtn}>
        ↑
      </button>
      <button type="button" onClick={() => move("down")} aria-label="Move down" className={styles.iconBtn}>
        ↓
      </button>
      <input
        type="number"
        value={targetSets}
        onChange={(e) => setTargetSets(Number(e.target.value))}
        title="Target sets"
      />
      <span>x</span>
      <input value={repRange} onChange={(e) => setRepRange(e.target.value)} placeholder="rep range" className={styles.repRange} />
      <span>@ RIR</span>
      <input value={rirTarget} onChange={(e) => setRirTarget(e.target.value)} className={styles.rir} />
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
    <section className={styles.day}>
      <div className={styles.dayHeader}>
        <input value={name} onChange={(e) => setName(e.target.value)} className={styles.dayName} />
        <button type="button" onClick={() => move("up")} aria-label={`Move ${dayNoun} up`} className={styles.iconBtn}>
          ↑
        </button>
        <button type="button" onClick={() => move("down")} aria-label={`Move ${dayNoun} down`} className={styles.iconBtn}>
          ↓
        </button>
        <button type="button" onClick={rename}>
          Rename
        </button>
        <button type="button" onClick={remove}>
          Delete {dayNoun}
        </button>
      </div>

      <ul className={styles.exList}>
        {day.exercises.map((ex) => (
          <ProgramExerciseRow key={ex.id} ex={ex} onChanged={onChanged} />
        ))}
      </ul>

      <AddExerciseForm dayId={day.id} exercises={exercises} onAdded={onChanged} />
    </section>
  );
}
