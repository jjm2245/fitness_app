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
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

const FIELD_LABEL: Record<CardioField, string> = {
  duration: "min",
  speed: "speed",
  incline: "incline",
  level: "level",
  distance: "distance",
};

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
  const p = ex.params ?? {};
  const [durationMin, setDurationMin] = useState<string>(String(num(p.duration_min) ?? ""));
  const [incline, setIncline] = useState<string>(String(num(p.incline) ?? ""));
  const [speed, setSpeed] = useState<string>(String(num(p.speed) ?? ""));
  const [distance, setDistance] = useState<string>("");
  const [level, setLevel] = useState<string>(String(num(p.level) ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
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
      const data: { cardio: { durationMin: string | null; incline: string | null; speed: string | null } | null } = await res.json();
      if (cancelled) return;
      if (!data.cardio) setPrevious(null);
      else {
        const bits = [
          data.cardio.durationMin ? `${data.cardio.durationMin} min` : null,
          data.cardio.incline ? `incline ${data.cardio.incline}` : null,
          data.cardio.speed ? `speed ${data.cardio.speed}` : null,
        ].filter(Boolean);
        setPrevious(`last · ${bits.join(", ") || "logged"}`);
      }
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

  const menuItems: CardMenuItem[] = [
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
          <div className={styles.chipsRow}>
            <span className={styles.chip}>cardio</span>
            {previous != null && <span className={styles.chip}>{previous}</span>}
            <span className={styles.chip}>{ex.source}</span>
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
