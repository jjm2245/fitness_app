"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, DayEditor, type ProgramDayDetail } from "@/components/DayEditor";
import styles from "@/components/DayEditor.module.css";

interface ProgramSummary {
  id: number;
  splitType: string;
  active: boolean;
}

interface ProgramDetail extends ProgramSummary {
  days: ProgramDayDetail[];
}

export default function ProgramEditorPage() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
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
    void (async () => {
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
    <main className={styles.page}>
      <p>
        <Link href="/log">Back to logging</Link>
      </p>
      <h1>Program editor</h1>

      <section className={styles.section}>
        <label>
          Program:{" "}
          <select value={selectedId ?? ""} onChange={(e) => selectProgram(Number(e.target.value))}>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.splitType} {p.active ? "(active)" : ""}
              </option>
            ))}
          </select>
        </label>
        {detail && !detail.active && (
          <button type="button" onClick={activateSelected}>
            Set active
          </button>
        )}
        <form onSubmit={createNewProgram} className={styles.inlineForm}>
          <input value={newProgramName} onChange={(e) => setNewProgramName(e.target.value)} placeholder="New program name" />
          <button type="submit">Create program</button>
        </form>
      </section>

      {detail && (
        <>
          <section className={styles.section}>
            <input value={programNameDraft} onChange={(e) => setProgramNameDraft(e.target.value)} />
            <button type="button" onClick={renameSelected}>
              Rename program
            </button>
            <button type="button" onClick={deleteSelected}>
              Delete program
            </button>
          </section>

          {detail.days.map((day) => (
            <DayEditor key={day.id} day={day} onChanged={() => refresh(selectedId!)} />
          ))}

          <form onSubmit={addDayToSelected} className={styles.inlineForm}>
            <input value={newDayName} onChange={(e) => setNewDayName(e.target.value)} placeholder="New day name" />
            <button type="submit">Add day</button>
          </form>
        </>
      )}
    </main>
  );
}
