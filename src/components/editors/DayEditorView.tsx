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
import { resolveMetricFields, routesToStrength } from "@/lib/logFields";
import { formatRangeValue, hasRangeValue } from "@/lib/targetValues";
import { TARGET_EFFORT_LABEL } from "@/lib/targetEffort";

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
  const src = { name: ex.exerciseName, conditioningOnly: ex.conditioningOnly, logFields: ex.logFields };
  if (!routesToStrength(src)) {
    // Metric-routed (the same config router as the session card + target
    // sheet). Anchor generalized: a duration OR a distance makes the target
    // valid; neither → "Set a target". Effort target reads from params.effort.
    const p = ex.params ?? {};
    if (!hasRangeValue(p.duration_min) && !hasRangeValue(p.distance)) return { text: "Set a target", muted: true };
    const parts: string[] = [];
    for (const f of resolveMetricFields(src)) {
      if (f === "duration") {
        const t = formatRangeValue(p.duration_min, "min");
        if (t) parts.push(t);
      } else if (f === "level" && typeof p.level === "number") parts.push(`level ${p.level}`);
      else if (f === "speed" && typeof p.speed === "number") parts.push(`${p.speed} speed`);
      else if (f === "incline" && typeof p.incline === "number") parts.push(`${p.incline} incline`);
      else if (f === "distance") {
        const t = formatRangeValue(p.distance, "mi");
        if (t) parts.push(t);
      }
    }
    if (typeof p.effort === "string" && p.effort in TARGET_EFFORT_LABEL) {
      parts.push(TARGET_EFFORT_LABEL[p.effort as keyof typeof TARGET_EFFORT_LABEL]);
    }
    return { text: parts.join(" · "), muted: false };
  }
  if (ex.targetSets == null) return { text: "Set a target", muted: true };
  const reps = ex.repRange ? ` × ${ex.repRange.replace("-", "–")}` : ex.targetSets === 1 ? " set" : " sets";
  const effort = ex.effortTarget ? ` · ${TARGET_EFFORT_LABEL[ex.effortTarget]}` : "";
  return { text: `${ex.targetSets}${reps}${effort}`, muted: false };
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
  // The exercise-list view. Opens on A–Z (a display lens); "custom" shows the
  // stored order_index and is the only mode where drag is enabled. The lenses are
  // non-destructive — they never write order_index, and the view is editor-local:
  // sessions always follow the stored order regardless of which lens is shown.
  const [viewMode, setViewMode] = useState<"custom" | "az" | "za" | "recent">("az");

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

  // Each day opens on the A–Z lens; switching days resets the view.
  useEffect(() => { setViewMode("az"); }, [selected?.id]);

  // A lens sorts the DISPLAY only — never the stored order_index.
  function sortedView(kind: "az" | "za" | "recent"): EditorExercise[] {
    const list = [...(selected?.exercises ?? [])];
    if (kind === "recent") list.sort((a, b) => b.id - a.id); // serial id = creation order
    else {
      list.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
      if (kind === "za") list.reverse();
    }
    return list;
  }
  const displayExercises = viewMode === "custom" ? orderedExercises : sortedView(viewMode);

  const editingEx = selected?.exercises.find((e) => e.id === editingExId) ?? null;

  async function commitExOrder(ids: number[]) {
    if (!selected) return;
    setExOrder(ids); // optimistic
    await api(`/api/program-days/${selected.id}/exercises/reorder`, { method: "POST", body: JSON.stringify({ orderedIds: ids }) });
    await onChanged();
  }

  async function deleteDay() {
    if (!selected) return;
    await api(`/api/program-days/${selected.id}`, { method: "DELETE" });
    setConfirmDelete(false);
    setSelectedId(null);
    await onChanged();
  }

  // The tappable row body (name + chip + chevron), shared by the draggable Custom
  // rows and the read-only lens rows so they render identically.
  const rowBody = (ex: EditorExercise) => (
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
  );

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
          {displayExercises.length === 0 ? (
            <p className={styles.emptyNote}>No exercises yet — add the first below.</p>
          ) : (
            <>
              {displayExercises.length > 1 && (
                <div className={styles.sortRow}>
                  <span className={styles.sortLabel}>View</span>
                  {(["az", "za", "recent", "custom"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={viewMode === m ? styles.sortChipActive : styles.sortChip}
                      onClick={() => setViewMode(m)}
                    >
                      {m === "az" ? "A–Z" : m === "za" ? "Z–A" : m === "recent" ? "Recent" : "Custom"}
                    </button>
                  ))}
                </div>
              )}
              {viewMode === "custom" ? (
                <SortableList ids={displayExercises.map((e) => String(e.id))} onReorder={(ids) => commitExOrder(ids.map(Number))}>
                  {displayExercises.map((ex) => (
                    <SortableRow key={ex.id} id={String(ex.id)}>
                      {(grip) => (
                        <div className={styles.row}>
                          <span ref={grip.ref} {...grip.props} aria-label="Drag to reorder">⋮⋮</span>
                          {rowBody(ex)}
                        </div>
                      )}
                    </SortableRow>
                  ))}
                </SortableList>
              ) : (
                displayExercises.map((ex) => (
                  <div key={ex.id} className={styles.row}>
                    <span className={styles.gripSpacer} aria-hidden="true" />
                    {rowBody(ex)}
                  </div>
                ))
              )}
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
