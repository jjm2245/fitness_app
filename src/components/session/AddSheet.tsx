"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import { ExerciseSearch, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import { prettyDayName } from "@/lib/labels";
import { cardioFields } from "@/lib/cardioFields";
import { rirToEffortTag, TARGET_EFFORT_LABEL } from "@/lib/targetEffort";
import type { BlockDetail, ProgramDetail, ProgramExerciseDetail } from "./shared";

// The session Add-exercise picker as a DRILL-IN navigator (not a flat/accordion
// list). One flat, full-width level at a time:
//   Screen 1 sources  → search + program rows (active first) + a Blocks row
//   Screen 2 container → a program's days, or the block library's blocks
//   Screen 3 items     → a day/block's exercises, each +/✓ to add/remove
// No dedupe: a day-Abs and a block-Abs are distinct objects, each reachable
// under its own source. Every program is navigable (not filtered); active is
// just first. Adding a day carries its prescriptions (targets ride along in the
// occurrence) but never prefills the log inputs.

type View =
  | { s: "sources" }
  | { s: "program"; prog: ProgramDetail }
  | { s: "blocks" }
  | { s: "day"; source: string; label: string; items: ProgramExerciseDetail[] };

// The target reference line shown under an exercise (same source the editor
// chip + session card use): strength "3 × 8–12 · near failure", cardio fields,
// or null when there's no target.
function targetRef(ex: ProgramExerciseDetail): string | null {
  if (ex.conditioningOnly) {
    const p = ex.params ?? {};
    const dur = p.duration_min;
    const hasDuration = (Array.isArray(dur) && dur.length === 2) || typeof dur === "number";
    if (!hasDuration) return null;
    const parts: string[] = [];
    for (const f of cardioFields(ex.exerciseName)) {
      if (f === "duration") parts.push(Array.isArray(dur) ? `${dur[0]}–${dur[1]} min` : `${dur} min`);
      else if (f === "level" && typeof p.level === "number") parts.push(`level ${p.level}`);
      else if (f === "speed" && typeof p.speed === "number") parts.push(`${p.speed} speed`);
      else if (f === "incline" && typeof p.incline === "number") parts.push(`${p.incline} incline`);
      else if (f === "distance" && typeof p.distance === "number") parts.push(`${p.distance} dist`);
    }
    return parts.length ? parts.join(" · ") : null;
  }
  if (ex.targetSets == null) return null;
  const reps = ex.repRange ? ` × ${ex.repRange.replace("-", "–")}` : ex.targetSets === 1 ? " set" : " sets";
  const tag = rirToEffortTag(ex.rirTarget);
  const effort = tag ? ` · ${TARGET_EFFORT_LABEL[tag]}` : "";
  return `${ex.targetSets}${reps}${effort}`;
}

const Chevron = () => (
  <svg className={styles.navChevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
    <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

export function AddSheet({
  programs,
  blocks,
  activeProgramId,
  addedIds,
  sessionCount,
  onAdd,
  onAddMany,
  onRemove,
  onAddAdhoc,
  onClose,
}: {
  programs: ProgramDetail[];
  blocks: BlockDetail[];
  activeProgramId: number | null;
  addedIds: Set<string>;
  sessionCount: number;
  onAdd: (ex: ProgramExerciseDetail, source: string) => void;
  onAddMany: (items: ProgramExerciseDetail[], source: string) => void;
  onRemove: (exerciseId: string) => void;
  onAddAdhoc: (r: ExerciseSearchResult) => void;
  onClose: () => void;
}) {
  const [stack, setStack] = useState<View[]>([{ s: "sources" }]);
  const view = stack[stack.length - 1];
  const push = (v: View) => setStack((s) => [...s, v]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // Active program first, then the rest in their given order.
  const orderedPrograms = [...programs].sort((a, b) =>
    a.id === activeProgramId ? -1 : b.id === activeProgramId ? 1 : 0
  );

  const footer = (
    <div className={styles.addFooter}>
      <span className={styles.addFooterCount}>{sessionCount} added this session</span>
      <button type="button" className={styles.addFooterDone} onClick={onClose}>Done</button>
    </div>
  );

  // A container row (program / blocks / day) — full-width, chevron = "go inside".
  // `quickAdd` (days/blocks) adds the whole thing without opening.
  const NavRow = ({ label, badge, count, onOpen, quickAdd }: {
    label: string; badge?: string; count: string; onOpen: () => void; quickAdd?: () => void;
  }) => (
    <div className={styles.navRow}>
      <button type="button" className={styles.navRowBody} onClick={onOpen}>
        <span className={styles.navRowName}>{label}{badge && <span className={styles.navBadge}>{badge}</span>}</span>
        <span className={styles.navRowMeta}>{count}</span>
      </button>
      {quickAdd && (
        <button type="button" className={styles.navQuickAdd} onClick={quickAdd} aria-label={`Add all of ${label}`}>+</button>
      )}
      <button type="button" className={styles.navRowChev} onClick={onOpen} aria-label={`Open ${label}`}><Chevron /></button>
    </div>
  );

  const Body = () => {
    if (view.s === "sources") {
      return (
        <>
          <div>
            <ExerciseSearch onPick={onAddAdhoc} placeholder="Search library / curated, or create custom…" />
          </div>
          <div className={styles.navSectionHead}>Programs</div>
          {orderedPrograms.map((prog) => (
            <NavRow
              key={`p${prog.id}`}
              label={prog.splitType}
              badge={prog.id === activeProgramId ? "active" : undefined}
              count={`${prog.days.length} ${prog.days.length === 1 ? "day" : "days"}`}
              onOpen={() => push({ s: "program", prog })}
            />
          ))}
          <div className={styles.navSectionHead}>Blocks</div>
          <NavRow
            label="Blocks"
            badge="reusable"
            count={`${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`}
            onOpen={() => push({ s: "blocks" })}
          />
        </>
      );
    }

    if (view.s === "program") {
      const prog = view.prog;
      return (
        <>
          <button type="button" className={styles.navBack} onClick={back}>
            ‹ {prog.splitType}{prog.id === activeProgramId && <span className={styles.navBadge}>active</span>}
          </button>
          {prog.days.map((d) => {
            const label = prettyDayName(d.name);
            return (
              <NavRow
                key={`d${d.id}`}
                label={label}
                count={`${d.exercises.length} ex`}
                onOpen={() => push({ s: "day", source: label, label, items: d.exercises })}
                quickAdd={() => onAddMany(d.exercises, label)}
              />
            );
          })}
        </>
      );
    }

    if (view.s === "blocks") {
      return (
        <>
          <button type="button" className={styles.navBack} onClick={back}>
            ‹ Blocks<span className={styles.navBadge}>reusable</span>
          </button>
          {blocks.map((b) => (
            <NavRow
              key={`b${b.id}`}
              label={b.name}
              count={`${b.exercises.length} ex`}
              onOpen={() => push({ s: "day", source: b.name, label: b.name, items: b.exercises })}
              quickAdd={() => onAddMany(b.exercises, b.name)}
            />
          ))}
        </>
      );
    }

    // view.s === "day" — exercises in a day/block
    return (
      <>
        <button type="button" className={styles.navBack} onClick={back}>‹ {view.label}</button>
        {view.items.length > 0 && (
          <button type="button" className={styles.addAllHero} onClick={() => onAddMany(view.items, view.source)}>
            Add all · {view.items.length} exercise{view.items.length === 1 ? "" : "s"}
          </button>
        )}
        {view.items.map((ex) => {
          const added = addedIds.has(ex.exerciseId);
          const ref = targetRef(ex);
          return (
            <div key={ex.id} className={`${styles.addExRow} ${added ? styles.addExRowDone : ""}`}>
              <span className={styles.addExMain}>
                <span className={styles.addExName}>{ex.exerciseName}</span>
                {ref && <span className={styles.addExTarget}>{ref}</span>}
              </span>
              <button
                type="button"
                className={added ? styles.addExBtnDone : styles.addExBtn}
                onClick={() => (added ? onRemove(ex.exerciseId) : onAdd(ex, view.source))}
                aria-label={added ? `Remove ${ex.exerciseName}` : `Add ${ex.exerciseName}`}
              >
                {added ? "✓" : "+"}
              </button>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <Sheet title="Add exercise" subtitle="Browse a program or block; tap ＋ to add. Add several, then Done." onClose={onClose} footer={footer}>
      <Body />
    </Sheet>
  );
}
