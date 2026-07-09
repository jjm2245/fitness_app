"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ProgramSummary {
  id: number;
  splitType: string;
  active: boolean;
}

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
}

interface ProgramDayDetail {
  id: number;
  programId: number;
  name: string;
  orderIndex: number;
  exercises: ProgramExerciseDetail[];
}

interface ProgramDetail extends ProgramSummary {
  days: ProgramDayDetail[];
}

interface ExerciseOption {
  id: string;
  name: string;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
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
      <input
        value={repRange}
        onChange={(e) => setRepRange(e.target.value)}
        placeholder="rep range"
        style={{ width: 70 }}
      />
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

function DayEditor({
  day,
  exercises,
  onChanged,
}: {
  day: ProgramDayDetail;
  exercises: ExerciseOption[];
  onChanged: () => void;
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
        <button type="button" onClick={() => move("up")} aria-label="Move day up">
          ↑
        </button>
        <button type="button" onClick={() => move("down")} aria-label="Move day down">
          ↓
        </button>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ fontWeight: "bold" }} />
        <button type="button" onClick={rename}>
          Rename
        </button>
        <button type="button" onClick={remove}>
          Delete day
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

export default function ProgramEditorPage() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [allExercises, setAllExercises] = useState<ExerciseOption[]>([]);
  const [newProgramName, setNewProgramName] = useState("");
  const [newDayName, setNewDayName] = useState("");
  const [programNameDraft, setProgramNameDraft] = useState("");

  const refresh = useCallback(async (idOverride?: number) => {
    const list = await api<ProgramSummary[]>("/api/programs");
    setPrograms(list);

    const targetId = idOverride ?? list.find((p) => p.active)?.id ?? list[0]?.id ?? null;
    setSelectedId(targetId);

    if (targetId) {
      const full = await api<ProgramDetail>(`/api/programs/${targetId}`);
      setDetail(full);
      setProgramNameDraft(full.splitType);
    } else {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const exs = await api<Array<{ id: string; name: string }>>("/api/exercises");
      setAllExercises(exs.map((e) => ({ id: e.id, name: e.name })));
      await refresh();
    })();
  }, [refresh]);

  async function selectProgram(id: number) {
    await refresh(id);
  }

  async function createNewProgram(e: React.FormEvent) {
    e.preventDefault();
    if (newProgramName.trim() === "") return;
    const program = await api<ProgramSummary>("/api/programs", {
      method: "POST",
      body: JSON.stringify({ splitType: newProgramName.trim() }),
    });
    setNewProgramName("");
    await refresh(program.id);
  }

  async function activateSelected() {
    if (!selectedId) return;
    await api(`/api/programs/${selectedId}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
    await refresh(selectedId);
  }

  async function renameSelected() {
    if (!selectedId || programNameDraft.trim() === "") return;
    await api(`/api/programs/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify({ splitType: programNameDraft.trim() }),
    });
    await refresh(selectedId);
  }

  async function deleteSelected() {
    if (!selectedId) return;
    await api(`/api/programs/${selectedId}`, { method: "DELETE" });
    await refresh();
  }

  async function addDayToSelected(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || newDayName.trim() === "") return;
    await api(`/api/programs/${selectedId}/days`, {
      method: "POST",
      body: JSON.stringify({ name: newDayName.trim() }),
    });
    setNewDayName("");
    await refresh(selectedId);
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/log">Back to logging</Link>
      </p>
      <h1>Program editor</h1>

      <section style={{ marginBottom: 20 }}>
        <label>
          Program:{" "}
          <select
            value={selectedId ?? ""}
            onChange={(e) => selectProgram(Number(e.target.value))}
          >
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.splitType} {p.active ? "(active)" : ""}
              </option>
            ))}
          </select>
        </label>{" "}
        {detail && !detail.active && (
          <button type="button" onClick={activateSelected}>
            Set active
          </button>
        )}
        <form onSubmit={createNewProgram} style={{ display: "inline-flex", gap: 6, marginLeft: 12 }}>
          <input
            value={newProgramName}
            onChange={(e) => setNewProgramName(e.target.value)}
            placeholder="New program name"
          />
          <button type="submit">Create program</button>
        </form>
      </section>

      {detail && (
        <>
          <section style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 20 }}>
            <input value={programNameDraft} onChange={(e) => setProgramNameDraft(e.target.value)} />
            <button type="button" onClick={renameSelected}>
              Rename program
            </button>
            <button type="button" onClick={deleteSelected}>
              Delete program
            </button>
          </section>

          {detail.days.map((day) => (
            <DayEditor key={day.id} day={day} exercises={allExercises} onChanged={() => refresh(selectedId!)} />
          ))}

          <form onSubmit={addDayToSelected} style={{ display: "flex", gap: 6 }}>
            <input value={newDayName} onChange={(e) => setNewDayName(e.target.value)} placeholder="New day name" />
            <button type="submit">Add day</button>
          </form>
        </>
      )}
    </main>
  );
}
