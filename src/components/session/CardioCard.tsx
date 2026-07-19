"use client";

import { useEffect, useState } from "react";
import styles from "./session.module.css";
import { ProvenanceBadge } from "@/components/ExerciseSearch";
import { logCardio, deleteCardio, type SessionCardio } from "@/lib/sessionStore";
import { CardMenu, type CardMenuItem } from "./CardMenu";
import type { CardControls, LoggableOccurrence } from "./shared";

type CardioField = "duration" | "speed" | "incline" | "level" | "distance";
function cardioFields(name: string): CardioField[] {
  const n = name.toLowerCase();
  if (n.includes("treadmill") || n.includes("incline walk") || n.includes("run")) {
    return ["duration", "speed", "incline"];
  }
  if (n.includes("stair") || n.includes("step")) return ["duration", "level"];
  if (n.includes("bike") || n.includes("cycl") || n.includes("spin")) return ["duration", "level", "distance"];
  if (n.includes("row")) return ["duration", "distance", "level"];
  return ["duration", "distance"];
}

const FIELD_LABEL: Record<CardioField, string> = {
  duration: "min",
  speed: "speed",
  incline: "incline",
  level: "level",
  distance: "distance",
};

// Shape returned by the last-session route for a conditioning exercise.
type CardioLast = {
  durationMin: string | null;
  incline: string | null;
  speed: string | null;
  distance: string | null;
  level: string | null;
};

// The "last" line, in the units THIS exercise actually uses (2.10) — e.g.
// "30 min · 3.0 speed · 12 incline" for a treadmill, "20 min · level 8" for a
// stair machine. Built from the same `fields` that drive the input cells.
function fmtCardioLast(fields: CardioField[], c: CardioLast): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === "duration" && c.durationMin != null) parts.push(`${c.durationMin} min`);
    else if (f === "speed" && c.speed != null) parts.push(`${c.speed} speed`);
    else if (f === "incline" && c.incline != null) parts.push(`${c.incline} incline`);
    else if (f === "level" && c.level != null) parts.push(`level ${c.level}`);
    else if (f === "distance" && c.distance != null) parts.push(`${c.distance} dist`);
  }
  return parts.join(" · ") || "logged";
}

// The cardio card (phase 2) — same collapsed/expanded treatment as strength,
// lighter body: contextual input cells + Log cardio; entries are read-only
// rows whose Delete appears on tap. Logic moved verbatim.
export function CardioCard({
  ex,
  sessionId,
  date,
  controls,
  sessionCardio,
  completed,
  onSessionChanged,
  onToggleComplete,
}: {
  ex: LoggableOccurrence;
  sessionId: string;
  date: string;
  controls: CardControls;
  sessionCardio: SessionCardio[];
  completed: boolean;
  onSessionChanged: () => void;
  onToggleComplete: (instanceId: string, completed: boolean) => void;
}) {
  // Inputs start EMPTY — like every other exercise. The program's prescribed
  // params aren't prefilled (that made the treadmill show 30/3/12 while others
  // were blank); the muted `last …` line is the reference instead.
  const [durationMin, setDurationMin] = useState<string>("");
  const [incline, setIncline] = useState<string>("");
  const [speed, setSpeed] = useState<string>("");
  const [distance, setDistance] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // The exercise's most recent cardio entry (exercise-level — cardio has no
  // lanes). Raw object; formatted in render against the current `fields`.
  const [lastCardio, setLastCardio] = useState<CardioLast | null>(null);
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });
  const [revealedId, setRevealedId] = useState<number | null>(null);

  const fields = cardioFields(ex.exerciseName);
  const entries = sessionCardio.filter((c) => c.instanceId === ex.instanceId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/exercises/${ex.exerciseId}/last-session`);
      const data: { cardio: CardioLast | null } = await res.json();
      if (cancelled) return;
      setLastCardio(data.cardio ?? null);
    })();
    return () => { cancelled = true; };
  }, [ex.exerciseId]);

  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    if (durationMin.trim() === "" && distance.trim() === "") {
      return setError("Enter at least a duration or distance.");
    }
    setError(null);
    await logCardio({
      sessionId,
      instanceId: ex.instanceId,
      date,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      durationMin: fields.includes("duration") ? toNum(durationMin) : null,
      incline: fields.includes("incline") ? toNum(incline) : null,
      speed: fields.includes("speed") ? toNum(speed) : null,
      distance: fields.includes("distance") ? toNum(distance) : null,
      level: fields.includes("level") ? toNum(level) : null,
      notes: null,
    });
    onSessionChanged();
  }

  // Re-open a done cardio entry for editing (revert-to-editable): un-completes
  // THIS occurrence only; the session's finish state is untouched. Re-finish =
  // re-check the done box.
  const menuItems: CardMenuItem[] = [
    ...(completed ? [{ label: "Edit exercise", onSelect: () => onToggleComplete(ex.instanceId, false) }] : []),
    { label: "Move up", onSelect: controls.onMoveUp, disabled: controls.position === 0 },
    { label: "Move down", onSelect: controls.onMoveDown, disabled: controls.position === controls.total - 1 },
    { label: "Remove exercise", onSelect: controls.onRemove, danger: true },
  ];

  const fieldState: Record<CardioField, [string, (v: string) => void]> = {
    duration: [durationMin, setDurationMin],
    speed: [speed, setSpeed],
    incline: [incline, setIncline],
    level: [level, setLevel],
    distance: [distance, setDistance],
  };

  // Same header language as the strength card (2.10): a muted, exercise-level
  // "last" line under the name. No source/category pill — the page is titled
  // by day. (There's no equipment/offset/lane/target here.)
  const lastText = lastCardio ? fmtCardioLast(fields, lastCardio) : null;

  return (
    // Dim only while collapsed; expanded done = readable review (no input).
    <li className={`${styles.card} ${completed && collapsed ? styles.cardDone : ""}`}>
      <div className={styles.headRow} role="button" tabIndex={0} onClick={toggleCollapsed} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleCollapsed(); }}>
        <input
          type="checkbox"
          className={styles.doneBox}
          checked={completed}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleComplete(ex.instanceId, e.target.checked)}
          title="Mark exercise done"
        />
        <span className={styles.exName}>{ex.exerciseName}</span>
        {!collapsed && <ProvenanceBadge untagged={ex.untagged} />}
        {collapsed && entries.length > 0 && (
          <span className={styles.countMuted}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        )}
        {collapsed && <span className={styles.srcTag}>[{ex.source}]</span>}
        <CardMenu items={menuItems} />
      </div>

      {!collapsed && (
        <div className={styles.cardBody}>
          <div className={styles.metaBlock}>
            <div className={styles.metaLine}>
              <span className={styles.metaLabel}>last</span>{" "}
              {lastText ?? <span className={styles.metaEmpty}>— no prior data</span>}
            </div>
          </div>

          {entries.length > 0 && (
            <ul className={styles.setsList}>
              {entries.map((c) => (
                <li key={c.localId}>
                  <button type="button" className={`${styles.cardioEntryRow} ${revealedId === c.localId ? styles.setRowActive : ""}`} onClick={() => setRevealedId((cur) => (cur === c.localId ? null : c.localId!))}>
                    <span className={c.syncState !== "synced" ? styles.setTickPending : styles.setTick} title={c.syncState !== "synced" ? "Not yet synced" : "Synced"}>
                      {c.syncState !== "synced" ? "○" : "✓"}
                    </span>
                    <span className={styles.setMain}>
                      {[
                        c.durationMin != null ? `${c.durationMin} min` : null,
                        c.incline != null ? `incline ${c.incline}` : null,
                        c.speed != null ? `speed ${c.speed}` : null,
                        c.distance != null ? `${c.distance} dist` : null,
                        c.level != null ? `level ${c.level}` : null,
                      ].filter(Boolean).join(", ") || "logged"}
                    </span>
                  </button>
                  {revealedId === c.localId && (
                    <div className={styles.setActions}>
                      <button type="button" onClick={async () => { await deleteCardio(c.localId!); onSessionChanged(); }}>Delete</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!completed && (
          <form onSubmit={handleLog}>
            <div className={styles.entryGrid} style={{ gridTemplateColumns: `repeat(${Math.min(fields.length, 3)}, 1fr)` }}>
              {fields.map((f) => (
                <label key={f} className={styles.cell}>
                  <span className={styles.cellLabel}>{FIELD_LABEL[f]}</span>
                  <input type="number" className={styles.cellInput} value={fieldState[f][0]} onChange={(e) => fieldState[f][1](e.target.value)} />
                </label>
              ))}
            </div>
            <button type="submit" className={styles.logBtn} style={{ marginTop: 8 }}>Log cardio</button>
          </form>
          )}
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      )}
    </li>
  );
}
