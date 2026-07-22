"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { CardMenu } from "@/components/session/CardMenu";
import { Sheet } from "@/components/session/Sheet";
import { NameSheet } from "@/components/editors/NameSheet";
import { DayEditorView } from "@/components/editors/DayEditorView";
import { api, type EditorDay } from "@/components/editors/types";

interface ProgramSummary {
  id: number;
  splitType: string;
  active: boolean;
}

interface ProgramDetail extends ProgramSummary {
  days: EditorDay[];
}

// Program editor (phase 3): program name as the title with a ⋯ menu; days as
// pill tabs; quiet exercise rows editing through sheets. All management
// operations survive — they moved from stacked button rows into the ⋯ + sheets.
export default function ProgramEditorPage() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async (idOverride?: number) => {
    const list = await api<ProgramSummary[]>("/api/programs");
    setPrograms(list);
    const targetId = idOverride ?? list.find((p) => p.active)?.id ?? list[0]?.id ?? null;
    setSelectedId(targetId);
    if (targetId) {
      setDetail(await api<ProgramDetail>(`/api/programs/${targetId}`));
    } else {
      setDetail(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshSelected = useCallback(async () => {
    await refresh(selectedId ?? undefined);
  }, [refresh, selectedId]);

  async function setActive() {
    if (!selectedId) return;
    await api(`/api/programs/${selectedId}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
    await refresh(selectedId);
  }

  async function deleteProgram() {
    if (!selectedId) return;
    await api(`/api/programs/${selectedId}`, { method: "DELETE" });
    setConfirmDelete(false);
    await refresh();
  }

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{detail ? detail.splitType : "Program"}</h1>
        {detail?.active && <span className={styles.titleTag}>active</span>}
        {detail && (
          <CardMenu
            label="Program menu"
            items={[
              { label: "Rename program…", onSelect: () => setRenaming(true) },
              ...(!detail.active ? [{ label: "Set as active program", onSelect: setActive }] : []),
              ...(programs.length > 1 ? [{ label: "Switch program…", onSelect: () => setSwitching(true) }] : []),
              { label: "New program…", onSelect: () => setCreating(true) },
              { label: "Delete program…", onSelect: () => setConfirmDelete(true), danger: true },
            ]}
          />
        )}
      </div>
      <p className={styles.hintLine}>Your training plan — ordered days your sessions follow in sequence.</p>

      {!loaded ? (
        <p className={styles.hintLine}>Loading…</p>
      ) : detail ? (
        <DayEditorView
          days={detail.days}
          noun="day"
          createTitle="New day"
          programId={detail.id}
          onChanged={refreshSelected}
        />
      ) : (
        <div className={styles.rowsCard}>
          <p className={styles.emptyNote}>No programs yet.</p>
          <button type="button" className={styles.addRow} onClick={() => setCreating(true)}>
            + Create a program
          </button>
        </div>
      )}

      {renaming && detail && (
        <NameSheet
          title="Rename program"
          label="Program name"
          initial={detail.splitType}
          submitLabel="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            await api(`/api/programs/${detail.id}`, { method: "PATCH", body: JSON.stringify({ splitType: name }) });
            await refresh(detail.id);
          }}
        />
      )}
      {creating && (
        <NameSheet
          title="New program"
          label="Program name"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            const p = await api<ProgramSummary>("/api/programs", {
              method: "POST",
              body: JSON.stringify({ splitType: name }),
            });
            await refresh(p.id);
          }}
        />
      )}
      {switching && (
        <Sheet title="Switch program" subtitle="Editing target only — the active program is what sessions use." onClose={() => setSwitching(false)}>
          <div className={styles.sheetList}>
            {programs.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.sheetRow}
                onClick={async () => {
                  setSwitching(false);
                  await refresh(p.id);
                }}
              >
                <span style={{ flex: 1 }}>{p.splitType}</span>
                {p.active && <span className={styles.titleTag}>active</span>}
                {p.id === selectedId && <span className={styles.sheetRowMuted}>editing</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {confirmDelete && detail && (
        <Sheet title="Delete program?" onClose={() => setConfirmDelete(false)}>
          <p className={styles.warnBox}>
            &ldquo;{detail.splitType}&rdquo; and its {detail.days.length} day{detail.days.length === 1 ? "" : "s"} will be
            deleted. Logged history is untouched.
          </p>
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={deleteProgram}>
              Delete program
            </button>
            <button type="button" className={styles.quietBtn} onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
