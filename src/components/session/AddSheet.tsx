"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import { ExerciseSearch, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import { prettyDayName } from "@/lib/labels";
import type { BlockDetail, ProgramDetail, ProgramExerciseDetail } from "./shared";

// The add palette as a bottom sheet (phase 2, Part 4): search on top, then
// program-day groups and blocks as one-tap chips. Adding is instant and the
// sheet STAYS OPEN for multi-add, exactly like the old always-open panel —
// only the container changed. The session's exercise list is the default view.
export function AddSheet({
  programs,
  blocks,
  onAdd,
  onAddAdhoc,
  onClose,
}: {
  programs: ProgramDetail[];
  blocks: BlockDetail[];
  onAdd: (ex: ProgramExerciseDetail, source: string) => void;
  onAddAdhoc: (r: ExerciseSearchResult) => void;
  onClose: () => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Dedupe by label: the seed exposes e.g. "Abs"/"Cardio" as both a program day
  // and a reusable block — show each once (program day wins, added first).
  const groups: { key: string; label: string; source: string; exercises: ProgramExerciseDetail[] }[] = [];
  const seenLabels = new Set<string>();
  for (const prog of programs) {
    for (const d of prog.days) {
      const label = prettyDayName(d.name);
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      groups.push({ key: `d${d.id}`, label, source: label, exercises: d.exercises });
    }
  }
  for (const b of blocks) {
    if (seenLabels.has(b.name)) continue;
    seenLabels.add(b.name);
    groups.push({ key: `b${b.id}`, label: b.name, source: b.name, exercises: b.exercises });
  }

  return (
    <Sheet title="Add exercise" subtitle="Tap to add as you go — order is kept. Add several; close when done." onClose={onClose}>
      {/* Plain block wrapper: ExerciseSearch's own `flex: 1 1 220px` (tuned
          for inline rows elsewhere) would otherwise become a 220px-tall flex
          item inside the sheet's column body. */}
      <div>
        <ExerciseSearch onPick={onAddAdhoc} placeholder="Search library / curated, or create custom…" />
      </div>
      {groups.map((g) => (
        <div key={g.key} className={styles.addGroup}>
          <button
            type="button"
            className={styles.addGroupHeader}
            onClick={() => setOpenGroup((o) => (o === g.key ? null : g.key))}
          >
            <span>{g.label}</span>
            <span className={styles.addGroupCount}>{g.exercises.length} {openGroup === g.key ? "▴" : "▾"}</span>
          </button>
          {openGroup === g.key && (
            <div className={styles.addChips}>
              {g.exercises.map((e) => (
                <button key={e.id} type="button" className={styles.addChip} onClick={() => onAdd(e, g.source)}>
                  + {e.exerciseName}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </Sheet>
  );
}
