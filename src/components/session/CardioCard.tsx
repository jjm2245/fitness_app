"use client";

import { useEffect, useState } from "react";
import styles from "./session.module.css";
import { ProvenanceBadge } from "@/components/ExerciseSearch";
import { logCardio, deleteCardio, type SessionCardio } from "@/lib/sessionStore";
import { CardMenu, type CardMenuItem } from "./CardMenu";
import type { CardControls, LoggableOccurrence } from "./shared";
import { CARDIO_FIELD_LABEL, type CardioField } from "@/lib/cardioFields";
import { resolveCardFields, type LogField } from "@/lib/logFields";

// Shape returned by the last-session route for a metric-routed exercise.
type CardioLast = {
  durationMin: string | null;
  incline: string | null;
  speed: string | null;
  distance: string | null;
  level: string | null;
  load?: string | null;
  effort?: string | null;
};

// Effort options in the session voice — the SAME stored values as the strength
// card (set_logs' enum), so target-vs-actual stays comparable.
const EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: "more_in_me", label: "More in me" },
  { value: "near_failure", label: "Near failure" },
  { value: "to_failure", label: "To failure" },
];
const EFFORT_LABEL: Record<string, string> = Object.fromEntries(EFFORT_OPTIONS.map((o) => [o.value, o.label]));

// Cell labels: unit where one exists (lb/min/mi), bare field name otherwise.
const CELL_LABEL: Record<string, string> = {
  weight: "lb",
  duration: CARDIO_FIELD_LABEL.duration, // "min"
  distance: "mi",
  speed: CARDIO_FIELD_LABEL.speed,
  incline: CARDIO_FIELD_LABEL.incline,
  level: CARDIO_FIELD_LABEL.level,
  effort: "effort",
};

// The "last" line, in the units THIS exercise actually uses — e.g.
// "30 min · 3.0 speed · 12 incline", or "135 lb · 5 min" for a loaded carry.
function fmtCardioLast(fields: LogField[], c: CardioLast): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === "weight" && c.load != null) parts.push(`${c.load} lb`);
    else if (f === "duration" && c.durationMin != null) parts.push(`${c.durationMin} min`);
    else if (f === "speed" && c.speed != null) parts.push(`${c.speed} speed`);
    else if (f === "incline" && c.incline != null) parts.push(`${c.incline} incline`);
    else if (f === "level" && c.level != null) parts.push(`level ${c.level}`);
    else if (f === "distance" && c.distance != null) parts.push(`${c.distance} mi`);
    else if (f === "effort" && c.effort != null) parts.push(EFFORT_LABEL[c.effort] ?? c.effort);
  }
  return parts.join(" · ") || "logged";
}

// The metric card (Phase 2: extended for mixed logging) — renders the RESOLVED
// field config as cells, now including Weight (lb) and Effort where configured.
// Blank-optional: configured-but-empty cells log as null; the one guard is the
// existing "at least a duration or distance". Writes cardio_logs (+ load/effort
// when filled) — never set_logs, so core's progression guard holds structurally.
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
  // params aren't prefilled; the muted `last …` line is the reference instead.
  const [durationMin, setDurationMin] = useState<string>("");
  const [incline, setIncline] = useState<string>("");
  const [speed, setSpeed] = useState<string>("");
  const [distance, setDistance] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [load, setLoad] = useState<string>("");
  const [effort, setEffort] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // The exercise's most recent cardio entry (exercise-level — no lanes here).
  const [lastCardio, setLastCardio] = useState<CardioLast | null>(null);
  // Mixed-history honesty: earlier strength history exists in the other mode.
  const [hasStrengthHistory, setHasStrengthHistory] = useState(false);
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });
  const [revealedId, setRevealedId] = useState<number | null>(null);

  // weight → metrics → effort, from the ONE resolver.
  const fields = resolveCardFields({ name: ex.exerciseName, conditioningOnly: ex.conditioningOnly, logFields: ex.logFields });
  const entries = sessionCardio.filter((c) => c.instanceId === ex.instanceId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/exercises/${ex.exerciseId}/last-session`);
      const data: { cardio: CardioLast | null; hasStrengthHistory?: boolean } = await res.json();
      if (cancelled) return;
      setLastCardio(data.cardio ?? null);
      setHasStrengthHistory(data.hasStrengthHistory ?? false);
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
      load: fields.includes("weight") ? toNum(load) : null,
      effort: fields.includes("effort") && effort !== "" ? effort : null,
      notes: null,
    });
    onSessionChanged();
  }

  // Re-open a done cardio entry for editing (revert-to-editable): un-completes
  // THIS occurrence only; the session's finish state is untouched.
  const menuItems: CardMenuItem[] = [
    ...(completed ? [{ label: "Edit exercise", onSelect: () => onToggleComplete(ex.instanceId, false) }] : []),
    { label: "Move up", onSelect: controls.onMoveUp, disabled: controls.position === 0 },
    { label: "Move down", onSelect: controls.onMoveDown, disabled: controls.position === controls.total - 1 },
    { label: "Remove exercise", onSelect: controls.onRemove, danger: true },
  ];

  const metricState: Record<CardioField, [string, (v: string) => void]> = {
    duration: [durationMin, setDurationMin],
    speed: [speed, setSpeed],
    incline: [incline, setIncline],
    level: [level, setLevel],
    distance: [distance, setDistance],
  };

  const lastText = lastCardio ? fmtCardioLast(fields, lastCardio) : null;

  // One entry row's summary text, honest about every stored value.
  const entryText = (c: SessionCardio) =>
    [
      c.load != null ? `${c.load} lb` : null,
      c.durationMin != null ? `${c.durationMin} min` : null,
      c.incline != null ? `incline ${c.incline}` : null,
      c.speed != null ? `speed ${c.speed}` : null,
      c.distance != null ? `${c.distance} mi` : null,
      c.level != null ? `level ${c.level}` : null,
      c.effort != null ? EFFORT_LABEL[c.effort] ?? c.effort : null,
    ].filter(Boolean).join(", ") || "logged";

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
              {lastText ?? (
                <span className={styles.metaEmpty}>
                  {hasStrengthHistory
                    ? "— no prior data in this mode · earlier strength history exists"
                    : "— no prior data"}
                </span>
              )}
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
                    <span className={styles.setMain}>{entryText(c)}</span>
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
              {fields.map((f) => {
                if (f === "weight") {
                  return (
                    <label key={f} className={styles.cell}>
                      <span className={styles.cellLabel}>{CELL_LABEL.weight}</span>
                      <input type="number" className={styles.cellInput} value={load} onChange={(e) => setLoad(e.target.value)} />
                    </label>
                  );
                }
                if (f === "effort") {
                  return (
                    <label key={f} className={styles.cell}>
                      <span className={styles.cellLabel}>{CELL_LABEL.effort}</span>
                      <select className={styles.cellInput} value={effort} onChange={(e) => setEffort(e.target.value)}>
                        <option value="">—</option>
                        {EFFORT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                  );
                }
                const metric = f as CardioField;
                return (
                  <label key={f} className={styles.cell}>
                    <span className={styles.cellLabel}>{CELL_LABEL[f] ?? f}</span>
                    <input type="number" className={styles.cellInput} value={metricState[metric][0]} onChange={(e) => metricState[metric][1](e.target.value)} />
                  </label>
                );
              })}
            </div>
            <button type="submit" className={styles.logBtn} style={{ marginTop: 8 }}>Log entry</button>
          </form>
          )}
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      )}
    </li>
  );
}
