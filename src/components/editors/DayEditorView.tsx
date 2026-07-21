"use client";

import { useEffect, useState } from "react";
import styles from "./editors.module.css";
import { CardMenu } from "@/components/session/CardMenu";
import { Sheet } from "@/components/session/Sheet";
import { NameSheet } from "./NameSheet";
import { TargetSheet } from "./TargetSheet";
import { AddExerciseSheet } from "./AddExerciseSheet";
import { DayOrganizeSheet } from "./DayOrganizeSheet";
import { SortableList, SortableRow } from "./SortableList";
import { api, type EditorDay, type EditorExercise } from "./types";
import { cardioFields } from "@/lib/cardioFields";

// The shared day/block editor engine (phase 3): horizontal pill tabs, one
// day's quiet exercise rows at a time, edit-by-sheet, add-by-sheet, day ⋯.
// A block is structurally a program_day, so /program and /blocks are this one
// component with `noun` relabeled — same routes, same rows.

// Display-only: stored "8-12" renders as "8–12"; storage is never rewritten.
// The single quiet chip. Stored values only DISPLAY differently ("8-12" → 8–12);
// nothing is rewritten. `null` = no target → muted, tappable "Set a target".
// Cardio never shows "1 set" — it shows the prescription (duration/incline/speed)
// from exercises.params, or "Set a target".
function targetChip(ex: EditorExercise): { text: string; muted: boolean } {
  if (ex.conditioningOnly) {
    // Same field-set source the target sheet + session card read, so the chip
    // shows exactly the fields this exercise prescribes (min+level for a stair
    // machine, min+speed+incline for a treadmill).
    const p = ex.params ?? {};
    const parts: string[] = [];
    for (const f of cardioFields(ex.exerciseName)) {
      if (f === "duration") {
        const dur = p.duration_min;
        if (Array.isArray(dur) && dur.length === 2) parts.push(`${dur[0]}–${dur[1]} min`);
        else if (typeof dur === "number") parts.push(`${dur} min`);
      } else if (f === "level" && typeof p.level === "number") parts.push(`level ${p.level}`);
      else if (f === "speed" && typeof p.speed === "number") parts.push(`${p.speed} speed`);
      else if (f === "incline" && typeof p.incline === "number") parts.push(`${p.incline} incline`);
      else if (f === "distance" && typeof p.distance === "number") parts.push(`${p.distance} dist`);
    }
    return parts.length ? { text: parts.join(" · "), muted: false } : { text: "Set a target", muted: true };
  }
  if (ex.targetSets == null) return { text: "Set a target", muted: true };
  const reps = ex.repRange ? ` × ${ex.repRange.replace("-", "–")}` : ex.targetSets === 1 ? " set" : " sets";
  const rir = ex.rirTarget != null && ex.rirTarget !== "" ? ` @ RIR ${ex.rirTarget}` : "";
  return { text: `${ex.targetSets}${reps}${rir}`, muted: false };
}

export function DayEditorView({
  days,
  noun,
  createTitle,
  programId,
  onChanged,
}: {
  days: EditorDay[];
  noun: "day" | "block";
  createTitle: string;
  // Required for noun="day" so a day can be created on an empty program.
  programId?: number;
  onChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [editingExId, setEditingExId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Keep the selection stable across refreshes; fall back to the first.
  const selected = days.find((d) => d.id === selectedId) ?? days[0] ?? null;
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  // Local exercise order for the selected day — reordered optimistically on drag
  // / sort, re-synced whenever the server order (props) changes.
  const serverExIds = selected ? selected.exercises.map((e) => e.id).join(",") : "";
  const [exOrder, setExOrder] = useState<number[]>([]);
  useEffect(() => {
    setExOrder(selected ? selected.exercises.map((e) => e.id) : []);
  }, [selected?.id, serverExIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const orderedExercises = exOrder
    .map((id) => selected?.exercises.find((e) => e.id === id))
    .filter((e): e is EditorExercise => e != null);

  const editingEx = selected?.exercises.find((e) => e.id === editingExId) ?? null;

  async function commitExOrder(ids: number[]) {
    if (!selected) return;
    setExOrder(ids); // optimistic
    await api(`/api/program-days/${selected.id}/exercises/reorder`, { method: "POST", body: JSON.stringify({ orderedIds: ids }) });
    await onChanged();
  }
  function sortExercises(kind: "az" | "za" | "recent") {
    if (!selected) return;
    const list = [...selected.exercises];
    if (kind === "recent") list.sort((a, b) => b.id - a.id); // serial id = creation order
    else {
      list.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
      if (kind === "za") list.reverse();
    }
    void commitExOrder(list.map((e) => e.id));
  }

  async function deleteDay() {
    if (!selected) return;
    await api(`/api/program-days/${selected.id}`, { method: "DELETE" });
    setConfirmDelete(false);
    setSelectedId(null);
    await onChanged();
  }

  return (
    <>
      <div className={styles.tabsWrap}>
        <div className={styles.tabsRow}>
          {days.map((d) => (
            <button
              key={d.id}
              type="button"
              className={d.id === selected?.id ? styles.tabActive : styles.tab}
              onClick={() => setSelectedId(d.id)}
            >
              {d.name}
            </button>
          ))}
          <button type="button" className={styles.tab} onClick={() => setCreating(true)} aria-label={createTitle}>
            +
          </button>
        </div>
        {selected && (
          <CardMenu
            label={`${noun} menu`}
            items={[
              { label: `Rename ${noun}…`, onSelect: () => setRenaming(true) },
              ...(days.length > 1 ? [{ label: "Organize order…", onSelect: () => setOrganizing(true) }] : []),
              { label: `Delete ${noun}…`, onSelect: () => setConfirmDelete(true), danger: true },
            ]}
          />
        )}
      </div>

      {selected ? (
        <div className={styles.rowsCard}>
          {orderedExercises.length === 0 ? (
            <p className={styles.emptyNote}>No exercises yet — add the first below.</p>
          ) : (
            <>
              {orderedExercises.length > 1 && (
                <div className={styles.sortRow}>
                  <span className={styles.sortLabel}>Sort</span>
                  <button type="button" className={styles.sortChip} onClick={() => sortExercises("az")}>A–Z</button>
                  <button type="button" className={styles.sortChip} onClick={() => sortExercises("za")}>Z–A</button>
                  <button type="button" className={styles.sortChip} onClick={() => sortExercises("recent")}>Recent</button>
                </div>
              )}
              <SortableList ids={orderedExercises.map((e) => String(e.id))} onReorder={(ids) => commitExOrder(ids.map(Number))}>
                {orderedExercises.map((ex) => (
                  <SortableRow key={ex.id} id={String(ex.id)}>
                    {(grip) => (
                      <div className={styles.row}>
                        <span ref={grip.ref} {...grip.props} aria-label="Drag to reorder">⋮⋮</span>
                        <button type="button" className={styles.rowBody} onClick={() => setEditingExId(ex.id)}>
                          <span className={styles.rowMain}>
                            <span className={styles.rowName}>
                              <span className={styles.rowNameText}>{ex.exerciseName}</span>
                              {ex.untagged && <span className={styles.badgeWarn}>untagged</span>}
                            </span>
                          </span>
                          {(() => { const c = targetChip(ex); return <span className={c.muted ? styles.rowChipMuted : styles.rowChip}>{c.text}</span>; })()}
                          <svg className={styles.rowChevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
                            <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </SortableRow>
                ))}
              </SortableList>
            </>
          )}
          <button type="button" className={styles.addRow} onClick={() => setAdding(true)}>
            + Add exercise
          </button>
        </div>
      ) : (
        <div className={styles.rowsCard}>
          <p className={styles.emptyNote}>No {noun}s yet — create the first with +.</p>
        </div>
      )}

      {creating && (
        <NameSheet
          title={createTitle}
          label="Name"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            if (noun === "block") {
              await api("/api/blocks", { method: "POST", body: JSON.stringify({ name }) });
            } else if (programId != null) {
              await api(`/api/programs/${programId}/days`, { method: "POST", body: JSON.stringify({ name }) });
            }
            await onChanged();
          }}
        />
      )}
      {renaming && selected && (
        <NameSheet
          title={`Rename ${noun}`}
          label="Name"
          initial={selected.name}
          submitLabel="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            await api(`/api/program-days/${selected.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
            await onChanged();
          }}
        />
      )}
      {confirmDelete && selected && (
        <Sheet title={`Delete ${noun}?`} onClose={() => setConfirmDelete(false)}>
          <p className={styles.warnBox}>
            &ldquo;{selected.name}&rdquo; and its {selected.exercises.length} exercise
            {selected.exercises.length === 1 ? "" : "s"} will be removed from this {noun === "day" ? "program" : "list"}.
            Logged history is untouched.
          </p>
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={deleteDay}>
              Delete {noun}
            </button>
            <button type="button" className={styles.quietBtn} onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </div>
        </Sheet>
      )}
      {editingEx && selected && (
        <TargetSheet ex={editingEx} onChanged={onChanged} onClose={() => setEditingExId(null)} />
      )}
      {adding && selected && (
        <AddExerciseSheet dayId={selected.id} noun={noun} onAdded={onChanged} onClose={() => setAdding(false)} />
      )}
      {organizing && selected && (
        <DayOrganizeSheet
          days={days}
          noun={noun}
          programId={selected.programId}
          onChanged={onChanged}
          onClose={() => setOrganizing(false)}
        />
      )}
    </>
  );
}
