"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./session.module.css";
import { ProvenanceBadge } from "@/components/ExerciseSearch";
import { EQUIPMENT_TYPES, EQUIPMENT_TYPE_BY_ID, laneKey, offsetPatch, suggestEquipmentType, type EquipmentTypeId } from "@/lib/equipment";
import { logSet, editSet, type SessionSet, type SetSide } from "@/lib/sessionStore";
import { publishRestTimer } from "@/lib/restTimerBus";
import { SetRow } from "./SetRow";
import { RestConnector } from "./RestConnector";
import { RestBanner } from "./RestBanner";
import { CardMenu, type CardMenuItem } from "./CardMenu";
import { AddUnitModal } from "./AddUnitModal";
import { SwapSheet } from "./SwapSheet";
import {
  EFFORT_OPTIONS,
  type CardControls,
  type EffortTag,
  type EquipmentOption,
  type LoggableOccurrence,
  type ProgressionResult,
  type SubstitutionCandidate,
} from "./shared";

// ——— identical persistence keys (moved verbatim from the log page) ———
function parseRepRangeMax(repRange: string | null): number {
  if (!repRange) return 12;
  const parts = repRange.split("-");
  const max = Number(parts[parts.length - 1]);
  return Number.isFinite(max) ? max : 12;
}
function lastEquipmentKey(exerciseId: string) {
  return `fitness-app:last-machine:${exerciseId}`;
}
function lastTypeKey(exerciseId: string) {
  return `fitness-app:last-equiptype:${exerciseId}`;
}
// One-time offset confirmation per (exercise, type): a keyword/type default may
// PRE-SELECT a non-zero offset but must never silently apply it — wrong-toward-
// zero costs nothing, wrong-toward-45 corrupts every set. Confirmed once,
// remembered here. (Named units' stored offsets are explicit → no prompt.)
function offsetOkKey(exerciseId: string, type: string) {
  return `fitness-app:offset-ok:${exerciseId}:${type}`;
}
// The neutral default: "I'm using a machine but haven't said which" — distinct
// from "No machine". Both resolve to a null equipmentId; a sentinel (not "") so
// it's distinguishable from an explicit choice in the UI.
const UNSPECIFIED_UNIT = "__unspecified__";
// One-time discoverability hint (tap a set to edit / drop) — global flag,
// dismissed forever on the first row tap.
const TAP_HINT_KEY = "fitness-app:hint-set-tap";

// The exercise card (phase 2): rows show information; controls appear on
// demand. The entire state machine below (offset machinery, lanes, timer→rest
// write, drop groups, swap, relabel) moved VERBATIM from the pre-rebuild
// StrengthCard — only the JSX changed.
export function StrengthCard({
  ex,
  sessionId,
  date,
  controls,
  sessionSets,
  completed,
  onSessionChanged,
  onToggleComplete,
  showTapHint,
}: {
  ex: LoggableOccurrence;
  sessionId: string;
  date: string;
  controls: CardControls;
  sessionSets: SessionSet[];
  completed: boolean;
  onSessionChanged: () => void;
  onToggleComplete: (instanceId: string, completed: boolean) => void;
  // True only for the session's FIRST card with logged sets — hosts the
  // one-time tap hint (no permanent chrome).
  showTapHint?: boolean;
}) {
  const [activeExercise, setActiveExercise] = useState({
    id: ex.exerciseId,
    name: ex.exerciseName,
    loadType: ex.loadType,
    portable: ex.portable,
    unilateral: ex.unilateral,
  });
  // Units curated for THIS exercise, not the global list.
  const [equipmentUnits, setEquipmentUnits] = useState<EquipmentOption[]>([]);
  const refreshEquipmentUnits = useCallback(async () => {
    const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/equipment`);
    if (res.ok) setEquipmentUnits(await res.json());
  }, [activeExercise.id]);
  // The equipment TYPE/unit are stored on this occurrence's logged sets (and
  // restored from the server on hydrate) — a finished session's machine
  // survives a PWA reinstall / localStorage wipe.
  const occStoredType = (sessionSets.find((x) => x.instanceId === ex.instanceId && x.equipmentType)?.equipmentType) as EquipmentTypeId | undefined;
  const occStoredUnit = sessionSets.find((x) => x.instanceId === ex.instanceId && x.equipmentId)?.equipmentId ?? null;
  const [equipTouched, setEquipTouched] = useState(false);
  const [equipmentId, setEquipmentId] = useState(() => {
    if (occStoredUnit) return occStoredUnit; // server-restored named unit wins
    if (typeof window === "undefined") return UNSPECIFIED_UNIT;
    return localStorage.getItem(lastEquipmentKey(ex.exerciseId)) ?? UNSPECIFIED_UNIT;
  });
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  const [load, setLoad] = useState(ex.loadType === "bodyweight" ? 0 : 45);
  const [reps, setReps] = useState(8);
  const [effort, setEffort] = useState<EffortTag | null>(null);
  // Unilateral side: recorded per set; auto-alternates L→R after logging.
  const [side, setSide] = useState<SetSide>("left");
  // Set-level rest timer: lives with THIS exercise's sets. Tap-to-start after
  // racking; stopping (or hitting the target) HOLDS the elapsed value, which is
  // auto-written as the NEXT set's restBefore (source "timed").
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [heldRest, setHeldRest] = useState<number | null>(null);
  // Display mirror of the running elapsed seconds (render never reads the clock).
  // (The timer target + notify feature was removed in 2.6-3: a separately-
  // timed rest is entered by tapping the rest connector after logging; the
  // timer is count-up + tap-to-stop + auto-write.)
  const [timerElapsed, setTimerElapsed] = useState(0);
  useEffect(() => {
    if (timerStart == null) return;
    const iv = setInterval(() => {
      setTimerElapsed(Math.floor((Date.now() - timerStart) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [timerStart]);
  // Mirror the running timer into the session bar (display-only bus — the bar
  // renders it; this card still owns start/stop and the rest write).
  useEffect(() => {
    publishRestTimer(timerStart);
    return () => publishRestTimer(null);
  }, [timerStart]);
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
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [recalDismissed, setRecalDismissed] = useState(false);
  const [progression, setProgression] = useState<ProgressionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SubstitutionCandidate[] | null>(null);
  const [manual, setManual] = useState<{ done: boolean; collapsed: boolean } | null>(null);
  const collapsed = manual && manual.done === completed ? manual.collapsed : completed;
  const toggleCollapsed = () => setManual({ done: completed, collapsed: !collapsed });
  // Which logged set has its action row revealed (one at a time).
  const [revealedSetId, setRevealedSetId] = useState<number | null>(null);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem(TAP_HINT_KEY) != null
  );
  function toggleReveal(localId: number) {
    if (!hintDismissed) {
      localStorage.setItem(TAP_HINT_KEY, "1");
      setHintDismissed(true);
    }
    setRevealedSetId((cur) => (cur === localId ? null : localId));
  }
  // Equipment editor visibility. null = automatic (open while the card has no
  // logged sets — equipment gets confirmed before the first set); a boolean is
  // the user's explicit toggle, so the chip ALWAYS does something, including
  // collapsing the zero-set auto-expanded row.
  const [equipOpen, setEquipOpen] = useState<boolean | null>(null);

  const [equipType, setEquipType] = useState<EquipmentTypeId>(() => {
    if (occStoredType && EQUIPMENT_TYPE_BY_ID.has(occStoredType)) return occStoredType; // server truth wins
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(lastTypeKey(ex.exerciseId));
      if (stored && EQUIPMENT_TYPE_BY_ID.has(stored as EquipmentTypeId)) return stored as EquipmentTypeId;
    }
    return suggestEquipmentType(ex.loadType, ex.exerciseName);
  });
  // The sets may load AFTER mount — restore type/unit once they arrive, unless
  // the user has since picked something (never clobber an in-progress choice).
  useEffect(() => {
    (async () => {
      if (equipTouched) return;
      if (occStoredType && EQUIPMENT_TYPE_BY_ID.has(occStoredType)) setEquipType(occStoredType);
      if (occStoredUnit) setEquipmentId(occStoredUnit);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occStoredType, occStoredUnit]);
  const typeDef = EQUIPMENT_TYPE_BY_ID.get(equipType)!;
  const contextBound = typeDef.instanceMatters;
  const resolvedUnitId = contextBound && equipmentId !== "" && equipmentId !== UNSPECIFIED_UNIT ? equipmentId : null;
  const selectedUnit = resolvedUnitId ? equipmentUnits.find((m) => m.id === resolvedUnitId) ?? null : null;
  const lane = laneKey(equipType, resolvedUnitId);

  // Offset: a named unit's stored offset pre-fills (explicit → no prompt);
  // otherwise the type default. Editable per set — a set-level override, never
  // a rewrite of the unit's default. Non-zero TYPE-LEVEL defaults are
  // UNCONFIRMED until once-confirmed per exercise (effOffset stays 0 until
  // then). plate_loaded default is unknown (null): prompted, never guessed.
  const occStoredOffset = (() => {
    const st = sessionSets.find((x) => x.instanceId === ex.instanceId && x.builtinOffset != null);
    return st?.builtinOffset ?? null;
  })();
  const defaultOffset = selectedUnit?.builtInWeight != null ? Number(selectedUnit.builtInWeight)
    : occStoredOffset != null ? occStoredOffset
    : typeDef.defaultOffset;
  const [offsetInput, setOffsetInput] = useState<string>(defaultOffset != null ? String(defaultOffset) : "");
  const [offsetTouched, setOffsetTouched] = useState(false);
  const [offsetConfirmed, setOffsetConfirmed] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem(offsetOkKey(ex.exerciseId, equipType)) != null
  );
  useEffect(() => {
    // Re-derive the pre-fill when the type/unit changes OR the stored offset
    // arrives (async set-load) — but never clobber a value you're mid-edit.
    (async () => {
      if (offsetTouched) return;
      setOffsetInput(defaultOffset != null ? String(defaultOffset) : "");
      setOffsetConfirmed(localStorage.getItem(offsetOkKey(activeExercise.id, equipType)) != null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipType, resolvedUnitId, activeExercise.id, occStoredOffset]);
  const offsetRelevant =
    typeDef.defaultOffset !== 0 || (selectedUnit?.builtInWeight != null && Number(selectedUnit.builtInWeight) !== 0);
  const offsetNum = offsetInput.trim() !== "" && Number.isFinite(Number(offsetInput)) ? Number(offsetInput) : 0;
  // Needs a one-tap confirmation: non-zero type-level default, not yet confirmed
  // for this exercise, and no explicit unit-stored offset backing it.
  const offsetNeedsConfirm = offsetRelevant && offsetNum !== 0 && !offsetConfirmed && selectedUnit?.builtInWeight == null;
  const effOffset = !offsetRelevant ? 0 : offsetNeedsConfirm ? 0 : offsetNum;
  const totalLoad = load + effOffset;
  function confirmOffset(value: number) {
    localStorage.setItem(offsetOkKey(activeExercise.id, equipType), String(value));
    setOffsetConfirmed(true);
  }
  function pickType(t: EquipmentTypeId) {
    setEquipType(t);
    localStorage.setItem(lastTypeKey(activeExercise.id), t);
    setEquipmentId(UNSPECIFIED_UNIT); // unit selection resets with the type
    setOffsetTouched(false); // let the new type's default/stored offset pre-fill
    setEquipTouched(true);
  }
  // Sets for THIS occurrence only (repeats keep separate set lists).
  const loggedSets = sessionSets.filter((s) => s.instanceId === ex.instanceId);

  // Load this exercise's curated unit list (always — the field is always on).
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}/equipment`);
      if (res.ok) setEquipmentUnits(await res.json());
    })();
  }, [activeExercise.id]);

  // Refresh flags that may have changed since this occurrence was snapshotted —
  // tagging an exercise unilateral must make its HISTORICAL sets side-editable
  // too, not just future ones. Offline: the snapshot stands.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/exercises/${encodeURIComponent(activeExercise.id)}`);
        if (res.ok) {
          const meta: { unilateral?: boolean } = await res.json();
          if (typeof meta.unilateral === "boolean") {
            setActiveExercise((a) => (a.unilateral === meta.unilateral ? a : { ...a, unilateral: meta.unilateral! }));
          }
        }
      } catch {
        /* offline — occurrence snapshot stands */
      }
    })();
  }, [activeExercise.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (lane) params.set("lane", lane);
      const res = await fetch(`/api/exercises/${activeExercise.id}/last-session?${params.toString()}`);
      const data: { session: { sets: Array<{ load: number; reps: number }> } | null } = await res.json();
      if (cancelled) return;
      if (data.session) {
        const reps = data.session.sets.map((s) => s.reps).join(", ");
        setPrevious(`last · ${data.session.sets[0]?.load ?? "?"} lb × ${reps}`);
      } else if (lane) {
        // Recalibrate, don't reset: no history in THIS lane, but show
        // continuity from the exercise's other lanes — effort + volume carry
        // over; switching units is never "starting over".
        const any = await fetch(`/api/exercises/${activeExercise.id}/last-session`);
        const anyData: { session: { sets: Array<{ load: number; reps: number }> } | null } = await any.json();
        if (cancelled) return;
        if (anyData.session) {
          setPrevious(`Recalibrating for this unit — you were at ${anyData.session.sets[0]?.load ?? "?"} lb on another unit (effort + volume carry over)`);
        } else {
          setPrevious(null);
        }
      } else {
        setPrevious(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeExercise.id, lane]);

  const checkProgression = useCallback(async () => {
    setChecking(true);
    try {
      const params = new URLSearchParams({
        exerciseId: activeExercise.id,
        repRangeMax: String(parseRepRangeMax(ex.target?.repRange ?? null)),
        targetRir: String(ex.target?.rirTarget ?? 2),
      });
      if (lane) params.set("lane", lane);
      const res = await fetch(`/api/progression?${params.toString()}`);
      setProgression(await res.json());
    } finally {
      setChecking(false);
    }
  }, [activeExercise.id, ex.target, lane]);

  async function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(reps) || reps < 1) return setError("Reps must be at least 1.");
    if (!Number.isFinite(load) || load < 0) return setError("Load can't be negative.");
    setError(null);
    await logSet({
      sessionId,
      instanceId: ex.instanceId,
      date,
      exerciseId: activeExercise.id,
      exerciseName: activeExercise.name,
      equipmentId: resolvedUnitId,
      equipmentLabel: selectedUnit?.label ?? null,
      equipmentType: equipType,
      equipmentBuiltInWeight: selectedUnit?.builtInWeight != null ? Number(selectedUnit.builtInWeight) : null,
      setType,
      // Effective load = entered + known offset; the components are stored too,
      // so the math stays visible ("90 + 20 = 110") and the core reads the total.
      load: totalLoad,
      loadEntered: effOffset !== 0 ? load : null,
      builtinOffset: effOffset !== 0 ? effOffset : null,
      reps,
      effort,
      rir: null,
      side: activeExercise.unilateral ? side : null,
      // If the rest timer is running, this set consumes it as an exact rest.
      timedRestSeconds: takeTimedRest(),
    });
    if (resolvedUnitId) localStorage.setItem(lastEquipmentKey(activeExercise.id), resolvedUnitId);
    // Auto-alternate for the next side-set (L→R→L…); "both" stays put.
    if (activeExercise.unilateral && side !== "both") setSide(side === "left" ? "right" : "left");
    onSessionChanged();
  }

  // Apply the current built-in offset to EVERY logged set of this exercise —
  // one machine, one offset. Each set's total = its entered value + the offset;
  // the entered value is preserved (back-derived on first application).
  // Explicit, never silent — this rewrites logged totals, so it's a deliberate
  // tap. For a named unit it also becomes that unit's stored default.
  async function applyOffsetToOccurrence() {
    const off = offsetNum;
    for (const st of loggedSets) {
      await editSet(st.localId!, {
        ...offsetPatch(st, off), // shared with tests — the arithmetic can't drift
        equipmentId: resolvedUnitId,
        equipmentLabel: selectedUnit?.label ?? null,
        equipmentType: equipType,
      });
    }
    if (selectedUnit) {
      try {
        await fetch(`/api/machines/${encodeURIComponent(selectedUnit.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ builtInWeight: off }),
        });
      } catch { /* offline — each set still carries the offset */ }
    }
    confirmOffset(off);
    onSessionChanged();
  }

  // Drop sets ("+ Drop"): a drop segment is its own set row, linked to its
  // parent by dropGroupId, sharing the parent's set number + occurrence.
  const [dropFor, setDropFor] = useState<SessionSet | null>(null);
  const [dropLoad, setDropLoad] = useState("");
  const [dropReps, setDropReps] = useState(8);
  async function startDrop(parent: SessionSet) {
    // Assign a group id in memory only — do NOT tag the parent yet (tagging on
    // tap left orphaned singleton groups). The parent is tagged in addDrop,
    // atomically with the segment.
    const groupId = parent.dropGroupId ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `g_${Date.now().toString(36)}`);
    setDropFor({ ...parent, dropGroupId: groupId });
    setDropLoad(""); // weight deliberately blank — you just stripped it
    setDropReps(parent.reps);
  }
  async function addDrop(e: React.FormEvent) {
    e.preventDefault();
    if (!dropFor) return;
    const l = Number(dropLoad);
    if (!Number.isFinite(l) || l < 0) return setError("Drop load can't be negative.");
    if (!Number.isFinite(dropReps) || dropReps < 1) return setError("Reps must be at least 1.");
    setError(null);
    // Tag the parent now — only once a real segment exists, so a group is never
    // left a singleton (re-setting the same id when stacking drops is harmless).
    if (dropFor.dropGroupId) await editSet(dropFor.localId!, { dropGroupId: dropFor.dropGroupId });
    await logSet({
      sessionId,
      instanceId: dropFor.instanceId, // drops inherit the parent's occurrence
      date,
      exerciseId: dropFor.exerciseId,
      exerciseName: dropFor.exerciseName,
      equipmentId: dropFor.equipmentId,
      equipmentLabel: dropFor.equipmentLabel ?? null,
      setType: dropFor.setType,
      load: l,
      reps: dropReps,
      effort: null,
      rir: null,
      dropGroupId: dropFor.dropGroupId,
      parentSetIndex: dropFor.setIndex,
      side: dropFor.side ?? null, // a drop continues the same side
    });
    setDropFor(null);
    onSessionChanged();
  }

  // Render order: keep log order, but pull each drop group together — parent
  // first (earliest row), its drops nested under it.
  const displaySets = useMemo(() => {
    const out: Array<{ set: SessionSet; isDrop: boolean }> = [];
    const emitted = new Set<number>();
    for (const s of loggedSets) {
      if (emitted.has(s.localId!)) continue;
      if (!s.dropGroupId) {
        out.push({ set: s, isDrop: false });
        emitted.add(s.localId!);
        continue;
      }
      const group = loggedSets.filter((g) => g.dropGroupId === s.dropGroupId);
      group.forEach((g, i) => {
        out.push({ set: g, isDrop: i > 0 });
        emitted.add(g.localId!);
      });
    }
    return out;
  }, [loggedSets]);

  async function openSwap() {
    setSwapOpen(true);
    if (swapCandidates) return;
    const res = await fetch(`/api/substitutions?exerciseId=${encodeURIComponent(ex.exerciseId)}`);
    setSwapCandidates(await res.json());
  }
  function pickSwap(c: SubstitutionCandidate) {
    setActiveExercise({ id: c.id, name: c.name, loadType: c.loadType, portable: c.portable, unilateral: c.unilateral ?? false });
    setEquipmentId(localStorage.getItem(lastEquipmentKey(c.id)) ?? UNSPECIFIED_UNIT);
    const storedT = localStorage.getItem(lastTypeKey(c.id));
    setEquipType(storedT && EQUIPMENT_TYPE_BY_ID.has(storedT as EquipmentTypeId) ? (storedT as EquipmentTypeId) : suggestEquipmentType(c.loadType, c.name));
    setSwapOpen(false);
  }
  function resetSwap() {
    setActiveExercise({ id: ex.exerciseId, name: ex.exerciseName, loadType: ex.loadType, portable: ex.portable, unilateral: ex.unilateral });
    setEquipmentId(localStorage.getItem(lastEquipmentKey(ex.exerciseId)) ?? UNSPECIFIED_UNIT);
    const storedT = localStorage.getItem(lastTypeKey(ex.exerciseId));
    setEquipType(storedT && EQUIPMENT_TYPE_BY_ID.has(storedT as EquipmentTypeId) ? (storedT as EquipmentTypeId) : suggestEquipmentType(ex.loadType, ex.exerciseName));
    setSwapOpen(false);
  }
  // Session-level relabel: naming a unit mid-session reassigns THIS session's
  // sets that sat in the type's unspecified lane. Prior sessions never touched.
  async function relabelSessionSets(unit: EquipmentOption) {
    const toMove = loggedSets.filter((s) => s.equipmentId == null && s.equipmentType === equipType);
    for (const st of toMove) {
      await editSet(st.localId!, { equipmentId: unit.id, equipmentLabel: unit.label, equipmentType: equipType });
    }
    if (toMove.length) onSessionChanged();
  }

  // ——— presentation ———
  const swapped = activeExercise.id !== ex.exerciseId;
  const isRecal = previous != null && previous.startsWith("Recalibrating");
  // A done card expanded is a REVIEW state, not a greyed logging state: chips
  // + logged rows + rests, fully readable, no input UI. Set rows stay
  // tappable for corrections; un-checking done restores logging.
  const review = completed;
  const equipEditorVisible = !review && (equipOpen ?? loggedSets.length === 0);
  // The chip always tells the CURRENT state without tapping (owner requirement).
  const unitChipText = selectedUnit
    ? `${selectedUnit.label}${selectedUnit.builtInWeight != null ? ` +${Number(selectedUnit.builtInWeight)}` : ""}`
    : `${typeDef.label.toLowerCase()}${contextBound ? " · unspecified" : ""}${offsetNum !== 0 && !offsetNeedsConfirm && offsetRelevant ? ` +${offsetNum}` : ""}`;

  const menuItems: CardMenuItem[] = [
    { label: "Swap exercise…", onSelect: openSwap },
    ...(swapped ? [{ label: `Undo swap (back to ${ex.exerciseName})`, onSelect: resetSwap }] : []),
    { label: "Move up", onSelect: controls.onMoveUp, disabled: controls.position === 0 },
    { label: "Move down", onSelect: controls.onMoveDown, disabled: controls.position === controls.total - 1 },
    { label: checking ? "Checking progression…" : "Check progression", onSelect: checkProgression, disabled: checking },
    { label: "Remove exercise", onSelect: controls.onRemove, danger: true },
  ];

  return (
    // Dim only while COLLAPSED — an expanded done card is the review state
    // and must be fully readable.
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
        <span className={styles.exName}>{activeExercise.name}</span>
        {!collapsed && <ProvenanceBadge untagged={ex.untagged} />}
        {swapped && <span className={styles.badgeQuiet}>swapped</span>}
        {collapsed && loggedSets.length > 0 && (
          <span className={styles.countMuted}>{loggedSets.length} {loggedSets.length === 1 ? "set" : "sets"}</span>
        )}
        {collapsed && <span className={styles.srcTag}>[{ex.source}]</span>}
        <CardMenu items={menuItems} />
      </div>

      {!collapsed && (
        <div className={styles.cardBody}>
          {/* Order (2.7-2): chip → editor (connected, directly beneath) →
              metadata pills. The editor belongs to the chip, not the pills. */}
          <div className={styles.chipsRow}>
            {review ? (
              // Review: the equipment state stays legible, but it's not an
              // editing surface — plain chip, no toggle.
              <span className={styles.chip}>{unitChipText}</span>
            ) : (
              <button type="button" className={styles.chipUnit} onClick={() => setEquipOpen(!equipEditorVisible)} title="Equipment for this exercise — tap to change">
                {unitChipText} <span aria-hidden="true">{equipEditorVisible ? "▴" : "▾"}</span>
              </button>
            )}
          </div>

          {equipEditorVisible && (
            <div className={styles.equipAttached}>
              <div className={styles.equipRow}>
                <label title="How resistance is applied to this set. Pre-selected from the exercise — a visible default, always editable, never hidden.">
                  <select className={styles.selectQuiet} value={equipType} onChange={(e) => pickType(e.target.value as EquipmentTypeId)}>
                    {EQUIPMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </label>
                {contextBound && (
                  <>
                    <select
                      className={styles.selectQuiet}
                      value={equipmentId === "" ? UNSPECIFIED_UNIT : equipmentId}
                      onChange={(e) => { setEquipmentId(e.target.value); setOffsetTouched(false); setEquipTouched(true); }}
                      title="Which unit — the same stack number means different resistance on different units, so each unit tracks its own lane."
                    >
                      <option value={UNSPECIFIED_UNIT}>Unspecified unit</option>
                      {equipmentUnits.map((m) => <option key={m.id} value={m.id}>{m.label}{m.builtInWeight != null ? ` (+${Number(m.builtInWeight)})` : ""}</option>)}
                    </select>
                    <button type="button" onClick={() => setUnitModalOpen(true)} className={styles.smallBtn}>+ New unit…</button>
                  </>
                )}
              </div>
              {offsetRelevant && (
                <div className={styles.equipRow}>
                  <label title="Constant added weight this equipment contributes (bar, carriage). Pre-filled from the unit/type default; editing here overrides THIS set only — the stored default is unchanged.">
                    + built-in{" "}
                    <input
                      type="number"
                      className={styles.offsetInput}
                      value={offsetInput}
                      onChange={(e) => { setOffsetTouched(true); setOffsetInput(e.target.value); if (!offsetConfirmed) confirmOffset(Number(e.target.value) || 0); }}
                      placeholder={typeDef.defaultOffset == null ? "?" : "lb"}
                    />
                  </label>
                  {offsetRelevant && !offsetNeedsConfirm && loggedSets.length > 0 && offsetNum !== (occStoredOffset ?? 0) && (
                    <button type="button" onClick={applyOffsetToOccurrence} className={styles.applyAllChip} title="One machine, one offset: apply this built-in to every set of this exercise. Your entered numbers are kept.">
                      apply +{offsetNum} to all {loggedSets.length} set{loggedSets.length === 1 ? "" : "s"}
                    </button>
                  )}
                  {offsetRelevant && typeDef.defaultOffset == null && offsetInput.trim() === "" && (
                    <span className={styles.warnNote} title="Plate-loaded carriage/handle weight is unit-specific — set it rather than guessing. Until then, loads record what you put on.">
                      carriage weight unknown — set it
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className={styles.chipsRow}>
            {previous != null && !isRecal && <span className={styles.chip}>{previous}</span>}
            {isRecal && !recalDismissed && (
              <span className={styles.chipRecal}>
                {previous}
                <button type="button" className={styles.chipDismiss} onClick={() => setRecalDismissed(true)} aria-label="Dismiss">✕</button>
              </span>
            )}
            {ex.target && (
              <span className={styles.chip}>target {ex.target.targetSets} × {ex.target.repRange ?? "?"}{ex.target.rirTarget != null ? ` @ RIR ${ex.target.rirTarget}` : ""}</span>
            )}
            <span className={styles.chip}>{ex.source}</span>
          </div>

          {unitModalOpen && (
            <AddUnitModal
              exerciseId={activeExercise.id}
              presetType={equipType}
              onClose={() => setUnitModalOpen(false)}
              onCreated={(unit) => {
                setUnitModalOpen(false);
                setEquipmentUnits((us) => [...us, unit]);
                setEquipmentId(unit.id);
                // Session-level relabel: within one session you are demonstrably
                // on one unit — re-point THIS session's unspecified sets of this
                // type onto the named unit. Prior sessions never backfilled.
                relabelSessionSets(unit);
                refreshEquipmentUnits();
              }}
            />
          )}

          {displaySets.length > 0 && (
            <ul className={styles.setsList}>
              {displaySets.map(({ set: s, isDrop }, i) => (
                // Rest is an edge: N sets ⇒ N−1 rests, rendered BETWEEN rows.
                // Set 1 has no edge (its "rest" would be the inter-exercise
                // transition — excluded); drops continue their parent's set.
                <Fragment key={s.localId}>
                  {i > 0 && !isDrop && <RestConnector set={s} onChanged={onSessionChanged} />}
                  <SetRow
                    set={s}
                    isDrop={isDrop}
                    unilateral={activeExercise.unilateral}
                    revealed={revealedSetId === s.localId}
                    onToggleReveal={() => toggleReveal(s.localId!)}
                    onChanged={onSessionChanged}
                    onDrop={startDrop}
                  />
                  {/* The drop entry renders directly under the set being
                      dropped — where the logged drop will live. */}
                  {dropFor?.localId === s.localId && (
                    <li>
                      <form onSubmit={addDrop} className={styles.dropForm}>
                        <span style={{ color: "var(--text-3)" }}>↳ drop:</span>
                        <input type="number" value={dropLoad} onChange={(e) => setDropLoad(e.target.value)} placeholder="lb" autoFocus style={{ width: 64 }} />
                        <span>×</span>
                        <input type="number" value={dropReps} onChange={(e) => setDropReps(Number(e.target.value))} style={{ width: 52 }} />
                        <button type="submit" className={styles.smallBtn}>Add drop</button>
                        <button type="button" onClick={() => setDropFor(null)} className={styles.smallBtn}>Cancel</button>
                      </form>
                    </li>
                  )}
                </Fragment>
              ))}
            </ul>
          )}
          {showTapHint && !hintDismissed && !review && loggedSets.length > 0 && (
            <p className={styles.tapHint}>tap a set to edit or add a drop</p>
          )}

          {loggedSets.length > 0 && !completed && (
            <RestBanner
              timerStart={timerStart}
              timerElapsed={timerElapsed}
              heldRest={heldRest}
              onStart={() => {
                setTimerStart(Date.now());
                setTimerElapsed(0);
              }}
              onStop={() => { setHeldRest(Math.round((Date.now() - timerStart!) / 1000)); setTimerStart(null); }}
              onDiscardHeld={() => setHeldRest(null)}
            />
          )}

          {progression && (
            <div className={styles.progNote}>
              {progression.status === "new_machine_baseline" ? (
                <span>Recalibrating for this unit — effort + volume carry over; you&rsquo;re not starting over.</span>
              ) : (
                <>
                  <span>
                    {progression.signal.type}
                    {"reason" in progression.signal ? `: ${progression.signal.reason}` : ""}
                    {progression.signal.type === "increase_load" && progression.signal.suggestedLoad != null ? ` (try ${progression.signal.suggestedLoad} lb)` : ""}
                  </span>
                  {progression.intervention && <div>Stall-buster: {progression.intervention.message}</div>}
                </>
              )}
            </div>
          )}

          {!review && (
          <form onSubmit={handleAddSet}>
            <div className={styles.entryMetaRow}>
              <select className={styles.typeSelect} value={setType} onChange={(e) => setSetType(e.target.value as "warmup" | "working")}>
                <option value="working">Working</option>
                <option value="warmup">Warm-up</option>
              </select>
              {effOffset !== 0 && (
                <span className={styles.offsetMath} title="Effective load = what you set + the known built-in weight. Progression uses the total.">
                  <strong>{totalLoad} lb</strong>
                  <span className={styles.setSuffix}> · {load} + {effOffset} built-in</span>
                </span>
              )}
              {offsetNeedsConfirm && (
                <button type="button" onClick={() => confirmOffset(offsetNum)} className={styles.confirmChip} title="A default offset is suggested but NOT applied until you confirm it — a wrong offset silently corrupts every set.">
                  apply +{offsetNum} {typeDef.label.toLowerCase()}? ✓
                </button>
              )}
            </div>
            <div className={styles.entryGrid} style={{ marginTop: 8 }}>
              <label className={styles.cell}>
                <span className={styles.cellLabel}>{ex.loadType === "bodyweight" ? "added lb" : "lb"}</span>
                <input type="number" className={styles.cellInput} value={load} onChange={(e) => setLoad(Number(e.target.value))} title={ex.loadType === "bodyweight" ? "Added weight (0 = bodyweight)" : "Load"} />
              </label>
              <label className={styles.cell}>
                <span className={styles.cellLabel}>reps</span>
                <input type="number" className={styles.cellInput} value={reps} onChange={(e) => setReps(Number(e.target.value))} title="Reps" />
              </label>
              <label className={styles.cell}>
                <span className={styles.cellLabel}>effort</span>
                <select className={styles.cellSelect} value={effort ?? ""} onChange={(e) => setEffort((e.target.value || null) as EffortTag | null)}>
                  <option value="">—</option>
                  {EFFORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            {activeExercise.unilateral && (
              <div className={styles.seg} style={{ marginTop: 8 }} title="Unilateral — which side is this set? Auto-alternates after each set.">
                {(["left", "right", "both"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSide(s)} className={side === s ? styles.segActive : styles.segBtn}>
                    {s === "left" ? "L" : s === "right" ? "R" : "Alternating"}
                  </button>
                ))}
              </div>
            )}
            <button type="submit" className={styles.logBtn} style={{ marginTop: 8 }}>Log set</button>
          </form>
          )}
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      )}

      {/* Fixed overlay — must render regardless of collapse state (the ⋯ menu
          offers Swap on a collapsed card too). */}
      {swapOpen && (
        <SwapSheet
          originalName={activeExercise.name}
          candidates={swapCandidates}
          onPick={pickSwap}
          onClose={() => setSwapOpen(false)}
        />
      )}
    </li>
  );
}
