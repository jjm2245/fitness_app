"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import { ExerciseSearch, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import { prettyDayName } from "@/lib/labels";
import { resolveMetricFields, routesToStrength } from "@/lib/logFields";
import { formatRangeValue, hasRangeValue } from "@/lib/targetValues";
import { rirToEffortTag, TARGET_EFFORT_LABEL } from "@/lib/targetEffort";
import type { BlockDetail, ProgramDetail, ProgramExerciseDetail } from "./shared";

// The session Add-exercise picker: a DRILL-IN, APPEND-ONLY navigator.
//   Screen 1 sources  → search + a row per program (active first) + a row per
//                       block (flattened — blocks drill straight to exercises)
//   Screen 2 days     → a program's days (nav-only)
//   Screen 3 exercises→ a day/block's exercises, each `+` appends another
//                       occurrence (duplicates allowed, add-order = session
//                       order); a `×N` count shows how many are in the session.
// The picker NEVER removes an occurrence — removal is deliberate, in the session
// view. The one exception is a transient Undo of a just-made "Add all" batch
// (unlogged rows only). Location is remembered across open/close via `nav`.

// A remembered location (persisted on the log page for the session's lifetime).
// `day` covers both a program day and a block — both are program_days, so a
// single dayId resolves either.
export type AddLoc =
  | { screen: "sources" }
  | { screen: "program"; programId: number }
  | { screen: "day"; dayId: number };

// The target reference line under an exercise (same source the editor chip +
// session card read): strength "3 × 8–12 · near failure", cardio fields, or null.
function targetRef(ex: ProgramExerciseDetail): string | null {
  const src = { name: ex.exerciseName, conditioningOnly: ex.conditioningOnly, logFields: ex.logFields };
  if (!routesToStrength(src)) {
    const p = ex.params ?? {};
    if (!hasRangeValue(p.duration_min) && !hasRangeValue(p.distance)) return null;
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
  addedCounts,
  sessionCount,
  nav,
  onNav,
  onAdd,
  onAddMany,
  onUndo,
  onAddAdhoc,
  onClose,
}: {
  programs: ProgramDetail[];
  blocks: BlockDetail[];
  activeProgramId: number | null;
  addedCounts: Map<string, number>;
  sessionCount: number;
  nav: AddLoc[];
  onNav: (nav: AddLoc[]) => void;
  onAdd: (ex: ProgramExerciseDetail, source: string) => void;
  onAddMany: (items: ProgramExerciseDetail[], source: string) => Promise<string[]>;
  onUndo: (instanceIds: string[]) => void;
  onAddAdhoc: (r: ExerciseSearchResult) => void;
  onClose: () => void;
}) {
  // The freshly-added "Add all" batch (occurrence instanceIds), offered for a
  // transient Undo until the next add or navigation. Sheet-local by design.
  const [lastBatch, setLastBatch] = useState<string[] | null>(null);

  const current = nav[nav.length - 1] ?? { screen: "sources" };
  const push = (loc: AddLoc) => { setLastBatch(null); onNav([...nav, loc]); };
  const back = () => { setLastBatch(null); if (nav.length > 1) onNav(nav.slice(0, -1)); };

  const orderedPrograms = [...programs].sort((a, b) =>
    a.id === activeProgramId ? -1 : b.id === activeProgramId ? 1 : 0
  );

  // Resolve a dayId → its exercises + labels (a program day or a block).
  function resolveDay(dayId: number): { items: ProgramExerciseDetail[]; label: string; source: string } | null {
    for (const p of programs) for (const d of p.days) if (d.id === dayId) {
      return { items: d.exercises, label: prettyDayName(d.name), source: prettyDayName(d.name) };
    }
    for (const b of blocks) if (b.id === dayId) return { items: b.exercises, label: b.name, source: b.name };
    return null;
  }

  function handleAdd(ex: ProgramExerciseDetail, source: string) {
    setLastBatch(null);
    onAdd(ex, source);
  }
  async function handleAddAll(items: ProgramExerciseDetail[], source: string) {
    const ids = await onAddMany(items, source);
    setLastBatch(ids);
  }
  function handleUndo() {
    if (lastBatch && lastBatch.length) onUndo(lastBatch);
    setLastBatch(null);
  }

  const footer = (
    <div className={styles.addFooter}>
      <span className={styles.addFooterCount}>{sessionCount} added this session</span>
      <span className={styles.addFooterActions}>
        {lastBatch && lastBatch.length > 0 && (
          <button type="button" className={styles.addFooterUndo} onClick={handleUndo}>Undo</button>
        )}
        <button type="button" className={styles.addFooterDone} onClick={onClose}>Done</button>
      </span>
    </div>
  );

  // A nav row (program / day / block) — chevron drills in. No add affordance.
  const NavRow = ({ label, badge, count, onOpen }: { label: string; badge?: string; count: string; onOpen: () => void }) => (
    <button type="button" className={styles.navRow} onClick={onOpen}>
      <span className={styles.navRowName}><span>{label}</span>{badge && <span className={styles.navBadge}>{badge}</span>}</span>
      <span className={styles.navRowMeta}>{count}</span>
      <span className={styles.navRowChev}><Chevron /></span>
    </button>
  );

  const ExerciseList = ({ items, label, source }: { items: ProgramExerciseDetail[]; label: string; source: string }) => (
    <>
      <div className={styles.navBackRow}>
        <button type="button" className={styles.navBack} onClick={back}>‹ {label}</button>
        {items.length > 0 && (
          <button type="button" className={styles.addAllBtn} onClick={() => handleAddAll(items, source)}>Add all · {items.length}</button>
        )}
      </div>
      {items.map((ex) => {
        const ref = targetRef(ex);
        const n = addedCounts.get(ex.exerciseId) ?? 0;
        return (
          <div key={ex.id} className={styles.addExRow}>
            <span className={styles.addExMain}>
              <span className={styles.addExName}>{ex.exerciseName}</span>
              {ref && <span className={styles.addExTarget}>{ref}</span>}
            </span>
            {n > 0 && <span className={styles.addExCount}>×{n}</span>}
            <button type="button" className={styles.addExBtn} onClick={() => handleAdd(ex, source)} aria-label={`Add ${ex.exerciseName}`}>+</button>
          </div>
        );
      })}
    </>
  );

  function Body() {
    if (current.screen === "sources") {
      return (
        <>
          <div><ExerciseSearch onPick={onAddAdhoc} placeholder="Search library / curated, or create custom…" /></div>
          <div className={styles.navSectionHead}>Programs</div>
          {orderedPrograms.map((prog) => (
            <NavRow
              key={`p${prog.id}`}
              label={prog.splitType}
              badge={prog.id === activeProgramId ? "active" : undefined}
              count={`${prog.days.length} ${prog.days.length === 1 ? "day" : "days"}`}
              onOpen={() => push({ screen: "program", programId: prog.id })}
            />
          ))}
          <div className={styles.navSectionHead}>Blocks</div>
          {blocks.map((b) => (
            <NavRow key={`b${b.id}`} label={b.name} count={`${b.exercises.length} ex`} onOpen={() => push({ screen: "day", dayId: b.id })} />
          ))}
        </>
      );
    }

    if (current.screen === "program") {
      const prog = programs.find((p) => p.id === current.programId);
      if (!prog) return <SourcesFallback />;
      return (
        <>
          <button type="button" className={styles.navBack} onClick={back}>
            ‹ {prog.splitType}{prog.id === activeProgramId && <span className={styles.navBadge}>active</span>}
          </button>
          {prog.days.map((d) => (
            <NavRow key={`d${d.id}`} label={prettyDayName(d.name)} count={`${d.exercises.length} ex`} onOpen={() => push({ screen: "day", dayId: d.id })} />
          ))}
        </>
      );
    }

    // current.screen === "day"
    const day = resolveDay(current.dayId);
    if (!day) return <SourcesFallback />;
    return <ExerciseList items={day.items} label={day.label} source={day.source} />;
  }

  // When a remembered container no longer exists, drop back to sources.
  function SourcesFallback() {
    return (
      <button type="button" className={styles.navBack} onClick={() => onNav([{ screen: "sources" }])}>‹ Back to sources</button>
    );
  }

  return (
    <Sheet title="Add exercise" subtitle="Browse a program or block; tap ＋ to add. Add several, then Done." onClose={onClose} footer={footer}>
      <Body />
    </Sheet>
  );
}
