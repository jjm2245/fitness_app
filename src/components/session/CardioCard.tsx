"use client";

import React, { useEffect, useState } from "react";
import styles from "./session.module.css";
import { EntryUnitLabel } from "./EntryUnitLabel";
import { ProvenanceBadge } from "@/components/ExerciseSearch";
import { logCardio, editCardio, deleteCardio, type SessionCardio } from "@/lib/sessionStore";
import { CardMenu, type CardMenuItem } from "./CardMenu";
import { RestBanner } from "./RestBanner";
import { RestConnector } from "./RestConnector";
import { publishRestTimer } from "@/lib/restTimerBus";
import { fmtRest, type CardControls, type LoggableOccurrence } from "./shared";
import { UnitNumberInput } from "@/components/UnitNumberInput";
import { NumberInput } from "@/components/NumberInput";
import { INT_DIGITS } from "@/lib/numericInput";

// A metric's own natural bound: incline and machine level are two-digit by
// construction, speed three; duration and distance keep the default.
const metricCap = (m: string) =>
  m === "incline" || m === "level" ? INT_DIGITS.incline : m === "speed" ? INT_DIGITS.speed : INT_DIGITS.default;
import { CARDIO_FIELD_LABEL, type CardioField } from "@/lib/cardioFields";
import { resolveCardFields, resolveMetricFields, type LogField } from "@/lib/logFields";
import { metricTargetParts, hasMetricTarget } from "@/lib/targetValues";
import { TARGET_EFFORT_LABEL } from "@/lib/targetEffort";
import { kgToLb, kmToMi, lbToKg, miToKm, displayLb, displayMi, type WeightUnit, type DistanceUnit } from "@/lib/units";
import { useWeightUnit, useDistanceUnit } from "@/lib/useUnit";

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
function fmtCardioLast(fields: LogField[], c: CardioLast, wUnit: WeightUnit, dUnit: DistanceUnit): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === "weight" && c.load != null) parts.push(wUnit === "kg" ? `${lbToKg(Number(c.load))} kg` : `${displayLb(Number(c.load))} lb`);
    else if (f === "duration" && c.durationMin != null) parts.push(`${c.durationMin} min`);
    else if (f === "speed" && c.speed != null) parts.push(`${c.speed} speed`);
    else if (f === "incline" && c.incline != null) parts.push(`${c.incline} incline`);
    else if (f === "level" && c.level != null) parts.push(`level ${c.level}`);
    else if (f === "distance" && c.distance != null) parts.push(dUnit === "km" ? `${miToKm(Number(c.distance))} km` : `${displayMi(Number(c.distance))} mi`);
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
  // Working vs warm-up — same control, default, and semantics as the strength
  // card. Warm-up entries are excluded wherever strength warm-ups are.
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  // Entry-side units (§7): type in kg/km, the shown conversion IS what stores
  // (lb nearest 0.5; mi 2 decimals). Canonical storage/display stays lb/mi.
  const [wUnit, toggleWeightUnit] = useWeightUnit();
  const [dUnit, toggleDistanceUnit] = useDistanceUnit();
  const toggleWUnit = () => { toggleWeightUnit(); setLoad(""); };
  const toggleDUnit = () => { toggleDistanceUnit(); setDistance(""); };
  // What actually stores for the two convertible cells.
  const canonicalLoad = load.trim() === "" ? null : wUnit === "kg" ? kgToLb(Number(load)) : Number(load);
  const canonicalDistance = distance.trim() === "" ? null : dUnit === "km" ? kmToMi(Number(distance)) : Number(distance);
  const [error, setError] = useState<string | null>(null);
  // The exercise's most recent cardio entry (exercise-level — no lanes here).
  const [lastCardio, setLastCardio] = useState<CardioLast | null>(null);
  // Mixed-history honesty: earlier strength history exists in the other mode.
  const [hasStrengthHistory, setHasStrengthHistory] = useState(false);
  // ── Rest (§2) — the SAME state machine + banner the strength card owns
  // (timer, bus mirror to the session bar). No stored rest for metric entries:
  // cardio_logs has no rest column, so the timer is reference-only here.
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [heldRest, setHeldRest] = useState<number | null>(null);
  useEffect(() => {
    if (timerStart == null) return;
    const iv = setInterval(() => {
      setTimerElapsed(Math.floor((Date.now() - timerStart) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [timerStart]);
  useEffect(() => {
    publishRestTimer(timerStart);
    return () => publishRestTimer(null);
  }, [timerStart]);
  // Mirror of the strength card's consumption: a held or still-running timer
  // becomes the next entry's rest (source "timed"), exactly once.
  function takeTimedRest(): number | null {
    if (heldRest != null) {
      const v = heldRest;
      setHeldRest(null);
      return v;
    }
    if (timerStart != null) {
      const v = (Date.now() - timerStart) / 1000;
      setTimerStart(null);
      return v;
    }
    return null;
  }
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });
  const [revealedId, setRevealedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dropForId, setDropForId] = useState<number | null>(null);

  // weight → metrics → effort, from the ONE resolver.
  const fields = resolveCardFields({ name: ex.exerciseName, canonicalName: ex.canonicalName, conditioningOnly: ex.conditioningOnly, logFields: ex.logFields });
  // "+ Drop" is a LOAD reduction — offered only when weight is in the resolved
  // field set (Loaded carry / Timed hold), never on a treadmill/distance entry.
  const canDrop = fields.includes("weight");
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
      distance: fields.includes("distance") ? canonicalDistance : null,
      level: fields.includes("level") ? toNum(level) : null,
      load: fields.includes("weight") ? canonicalLoad : null,
      effort: fields.includes("effort") && effort !== "" ? effort : null,
      setType,
      // If the rest timer is running/held, this entry consumes it as an exact
      // rest — the same path and semantics as a strength set.
      timedRestSeconds: takeTimedRest(),
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

  const lastText = lastCardio ? fmtCardioLast(fields, lastCardio, wUnit, dUnit) : null;
  // §3: the `target` reference — metric targets live on the exercise's params
  // (exercise-level, always available), rendered through the same builder the
  // program chip and Add-picker use.
  const targetParts = hasMetricTarget(ex.params)
    ? metricTargetParts(ex.params, resolveMetricFields({ name: ex.exerciseName, canonicalName: ex.canonicalName, conditioningOnly: ex.conditioningOnly, logFields: ex.logFields }), dUnit, TARGET_EFFORT_LABEL)
    : [];
  const targetText = targetParts.length > 0 ? targetParts.join(" · ") : null;

  // §4 value hierarchy (mirrors the strength row): headline metrics read
  // prominently; machine settings are a muted suffix; effort renders at the
  // row's right (not inline); rest is its own connector row between entries.
  const entryPrimary = (c: SessionCardio) =>
    [
      c.load != null ? (wUnit === "kg" ? `${lbToKg(c.load)} kg` : `${displayLb(c.load)} lb`) : null,
      c.durationMin != null ? `${c.durationMin} min` : null,
      c.distance != null ? (dUnit === "km" ? `${miToKm(c.distance)} km` : `${displayMi(c.distance)} mi`) : null,
    ].filter(Boolean).join(" · ") || "logged";
  const entrySuffix = (c: SessionCardio) =>
    [
      c.speed != null ? `${c.speed} speed` : null,
      c.incline != null ? `${c.incline} incline` : null,
      c.level != null ? `level ${c.level}` : null,
    ].filter(Boolean).join(" · ");

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
            {targetText && (
              <div className={styles.metaLine}>
                <span className={styles.metaLabel}>target</span> {targetText}
              </div>
            )}
          </div>

          {entries.length > 0 && (
            <ul className={styles.setsList}>
              {entries.map((c, idx) => {
                // A drop is any grouped entry that FOLLOWS another of its group
                // (the first is the parent) — same visual grammar as strength.
                const isDrop =
                  c.dropSetGroup != null && entries.slice(0, idx).some((e) => e.dropSetGroup === c.dropSetGroup);
                if (editingId === c.localId) {
                  return (
                    <MetricEntryEdit
                      key={c.localId}
                      entry={c}
                      isDrop={isDrop}
                      onDone={() => { setEditingId(null); onSessionChanged(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  );
                }
                return (
                  <React.Fragment key={c.localId}>
                    {/* Rest is the EDGE before this entry — its own sub-row,
                        exactly as the strength card renders it. */}
                    {idx > 0 && !isDrop && (
                      <RestConnector
                        restSeconds={c.restSeconds ?? null}
                        restSource={c.restSource ?? null}
                        onSave={async (sec) => { await editCardio(c.localId!, { restSeconds: sec, restSource: "user" }); onSessionChanged(); }}
                      />
                    )}
                  <li>
                    <div className={isDrop ? styles.setDropWrap : undefined}>
                      <button type="button" className={`${styles.cardioEntryRow} ${revealedId === c.localId ? styles.setRowActive : ""}`} onClick={() => setRevealedId((cur) => (cur === c.localId ? null : c.localId!))}>
                        <span className={c.syncState !== "synced" ? styles.setTickPending : styles.setTick} title={c.syncState !== "synced" ? "Not yet synced" : "Synced"}>
                          {c.syncState !== "synced" ? "○" : "✓"}
                        </span>
                        <span className={styles.setMain}>
                          {isDrop && <span className={styles.setKind}>↳ drop · </span>}
                          {!isDrop && c.setType === "warmup" && <span className={styles.setKind}>warm-up · </span>}
                          {entryPrimary(c)}
                          {entrySuffix(c) && <span className={styles.setSuffix}> · {entrySuffix(c)}</span>}
                        </span>
                        {c.effort && <span className={styles.setEffort}>{EFFORT_LABEL[c.effort] ?? c.effort}</span>}
                        <span className={styles.setChevron} aria-hidden="true">›</span>
                      </button>
                      {revealedId === c.localId && (
                        <div className={styles.setActions}>
                          <button type="button" onClick={() => { setEditingId(c.localId!); setDropForId(null); }}>Edit</button>
                          <button type="button" onClick={async () => { await deleteCardio(c.localId!); onSessionChanged(); }}>Delete</button>
                          {canDrop && (
                            <button type="button" onClick={() => { setDropForId(c.localId!); setEditingId(null); }} title="Add a reduced-load segment under this entry">+ Drop</button>
                          )}
                        </div>
                      )}
                      {dropForId === c.localId && (
                        <MetricDropForm
                          parent={c}
                          onDone={() => { setDropForId(null); onSessionChanged(); }}
                          onCancel={() => setDropForId(null)}
                        />
                      )}
                    </div>
                  </li>
                  </React.Fragment>
                );
              })}
            </ul>
          )}
          {/* Discoverability hint — the strength card's equivalent, worded for
              entries (drops only where a load exists). */}
          {entries.length > 0 && !completed && (
            <p className={styles.tapHint}>tap an entry to edit{canDrop ? " or add a drop" : ""}</p>
          )}

          {entries.length > 0 && !completed && (
            <RestBanner
              timerStart={timerStart}
              timerElapsed={timerElapsed}
              heldRest={heldRest}
              nextNoun="entry"
              onStart={() => { setTimerStart(Date.now()); setTimerElapsed(0); }}
              onStop={() => { setHeldRest(Math.round((Date.now() - timerStart!) / 1000)); setTimerStart(null); }}
              onDiscardHeld={() => setHeldRest(null)}
            />
          )}

          {!completed && (
          <form onSubmit={handleLog}>
            <div className={styles.entryMetaRow}>
              <select className={styles.typeSelect} value={setType} onChange={(e) => setSetType(e.target.value as "warmup" | "working")}>
                <option value="working">Working</option>
                <option value="warmup">Warm-up</option>
              </select>
            </div>
            {/* Balanced grid (§6): ≤3 numeric cells → one row; 4 → 2×2. Effort
                is a consistent full-width control below — never an orphan cell. */}
            {(() => {
              const numeric = fields.filter((f) => f !== "effort");
              const cols = numeric.length <= 3 ? Math.max(numeric.length, 1) : 2;
              return (
                <div className={styles.entryGrid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                  {numeric.map((f) => {
                    if (f === "weight") {
                      return (
                        <label key={f} className={styles.cell}>
                          <span className={styles.cellLabel}>
                            <EntryUnitLabel unit={wUnit} canonicalUnit="lb" />
                          </span>
                          <NumberInput className={styles.cellInput} value={load} onChange={setLoad} />
                        </label>
                      );
                    }
                    if (f === "distance") {
                      return (
                        <label key={f} className={styles.cell}>
                          <span className={styles.cellLabel}>
                            <EntryUnitLabel unit={dUnit} canonicalUnit="mi" />
                          </span>
                          <NumberInput className={styles.cellInput} value={distance} onChange={setDistance} />
                        </label>
                      );
                    }
                    const metric = f as CardioField;
                    return (
                      <label key={f} className={styles.cell}>
                        <span className={styles.cellLabel}>{CELL_LABEL[f] ?? f}</span>
                        <NumberInput className={styles.cellInput} value={metricState[metric][0]} onChange={metricState[metric][1]} maxIntDigits={metricCap(metric)} />
                      </label>
                    );
                  })}
                </div>
              );
            })()}
            {fields.includes("effort") && (
              <label className={styles.effortRow}>
                <span className={styles.cellLabel}>{CELL_LABEL.effort}</span>
                <select className={styles.cellSelect} value={effort} onChange={(e) => setEffort(e.target.value)}>
                  <option value="">—</option>
                  {EFFORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className={styles.logBtn} style={{ marginTop: 8 }}>Log entry</button>
          </form>
          )}
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      )}
    </li>
  );
}

// Inline edit for a logged metric entry — mirror of SetRow's edit. FORWARD-ONLY:
// the form offers exactly the fields the ENTRY carries (non-null columns), not
// the exercise's current config — an entry logged before a profile change keeps
// its own shape. Weight/distance inputs follow the global unit preference
// (canonical in state; display converted).
function MetricEntryEdit({
  entry,
  isDrop,
  onDone,
  onCancel,
}: {
  entry: SessionCardio;
  isDrop: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [durationMin, setDurationMin] = useState(entry.durationMin != null ? String(entry.durationMin) : "");
  const [incline, setIncline] = useState(entry.incline != null ? String(entry.incline) : "");
  const [speed, setSpeed] = useState(entry.speed != null ? String(entry.speed) : "");
  const [distance, setDistance] = useState(entry.distance != null ? String(entry.distance) : "");
  const [level, setLevel] = useState(entry.level != null ? String(entry.level) : "");
  const [load, setLoad] = useState(entry.load != null ? String(entry.load) : "");
  const [effort, setEffort] = useState(entry.effort ?? "");
  const [err, setErr] = useState<string | null>(null);

  const has = {
    duration: entry.durationMin != null,
    incline: entry.incline != null,
    speed: entry.speed != null,
    distance: entry.distance != null,
    level: entry.level != null,
    load: entry.load != null,
    effort: entry.effort != null,
  };
  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save() {
    // The entry's own anchor rule: if it carried a duration or distance, it
    // must keep at least one after the edit.
    if ((has.duration || has.distance) && toNum(durationMin) == null && toNum(distance) == null) {
      return setErr("Keep at least a duration or distance.");
    }
    const patch: Record<string, number | string | null> = {};
    if (has.duration) patch.durationMin = toNum(durationMin);
    if (has.incline) patch.incline = toNum(incline);
    if (has.speed) patch.speed = toNum(speed);
    if (has.distance) patch.distance = toNum(distance);
    if (has.level) patch.level = toNum(level);
    if (has.load) patch.load = toNum(load);
    if (has.effort) patch.effort = effort === "" ? null : effort;
    await editCardio(entry.localId!, patch);
    onDone();
  }

  return (
    <li>
      <div className={styles.setEditRow} style={isDrop ? { paddingLeft: 22 } : undefined}>
        {has.load && <UnitNumberInput canonical={load} onCanonical={setLoad} dimension="weight" style={{ width: 64 }} />}
        {has.duration && <NumberInput value={durationMin} onChange={setDurationMin} placeholder="min" style={{ width: 56 }} />}
        {has.distance && <UnitNumberInput canonical={distance} onCanonical={setDistance} dimension="distance" style={{ width: 60 }} />}
        {has.speed && <NumberInput value={speed} onChange={setSpeed} placeholder="speed" style={{ width: 56 }} maxIntDigits={INT_DIGITS.speed} />}
        {has.incline && <NumberInput value={incline} onChange={setIncline} placeholder="incline" style={{ width: 56 }} maxIntDigits={INT_DIGITS.incline} />}
        {has.level && <NumberInput value={level} onChange={setLevel} placeholder="level" style={{ width: 52 }} maxIntDigits={INT_DIGITS.level} />}
        {has.effort && (
          <select value={effort} onChange={(e) => setEffort(e.target.value)} className={styles.selectQuiet}>
            <option value="">effort —</option>
            {EFFORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button type="button" onClick={save} className={styles.smallBtn}>Save</button>
        <button type="button" onClick={onCancel} className={styles.smallBtn}>Cancel</button>
      </div>
      {err && <p className={styles.errorText}>{err}</p>}
    </li>
  );
}

// "+ Drop" on a metric entry — a REDUCED-LOAD segment, mirroring the strength
// drop's storage: the parent + drops share a client-generated drop_set_group;
// the drop is its own cardio_logs row (load lower, its own duration/distance).
function MetricDropForm({
  parent,
  onDone,
  onCancel,
}: {
  parent: SessionCardio;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [load, setLoad] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [distance, setDistance] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

  async function commit() {
    const l = toNum(load);
    if (l == null || l < 0) return setErr("Enter the reduced load.");
    if (toNum(durationMin) == null && toNum(distance) == null) {
      return setErr("Enter at least a duration or distance.");
    }
    setErr(null);
    const group = parent.dropSetGroup ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
    // Tag the parent once a real segment exists (same rule as strength drops).
    if (parent.dropSetGroup == null) await editCardio(parent.localId!, { dropSetGroup: group });
    await logCardio({
      sessionId: parent.sessionId,
      instanceId: parent.instanceId, // drops inherit the parent's occurrence
      date: parent.date,
      exerciseId: parent.exerciseId,
      exerciseName: parent.exerciseName,
      durationMin: toNum(durationMin),
      incline: null,
      speed: null,
      distance: toNum(distance),
      level: null,
      load: l,
      effort: null,
      dropSetGroup: group,
      notes: null,
    });
    onDone();
  }

  return (
    <div className={styles.setEditRow} style={{ paddingLeft: 22 }}>
      <span className={styles.setKind}>↳ drop</span>
      <UnitNumberInput canonical={load} onCanonical={setLoad} dimension="weight" style={{ width: 64 }} autoFocus />
      <NumberInput value={durationMin} onChange={setDurationMin} placeholder="min" style={{ width: 56 }} />
      <UnitNumberInput canonical={distance} onCanonical={setDistance} dimension="distance" style={{ width: 60 }} />
      <button type="button" onClick={commit} className={styles.smallBtn}>Add</button>
      <button type="button" onClick={onCancel} className={styles.smallBtn}>Cancel</button>
      {err && <p className={styles.errorText}>{err}</p>}
    </div>
  );
}
