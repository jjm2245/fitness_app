"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./session.module.css";
import { ProvenanceBadge } from "@/components/ExerciseSearch";
import { EQUIPMENT_TYPES, EQUIPMENT_TYPE_BY_ID, laneKey, offsetPatch, suggestEquipmentType, type EquipmentTypeId } from "@/lib/equipment";
import { logSet, editSet, type SessionSet, type SetSide } from "@/lib/sessionStore";
import { parseStackMarking, resolveWeightUnit, formatDualWeight } from "@/lib/stack";
import { nextSelectableLoad, checkLoadSanity, type GridSpec } from "@/lib/nextLoad";
import { NumberInput } from "@/components/NumberInput";
import { INT_DIGITS } from "@/lib/numericInput";
import { detectUnitSlip, recentLoadsFromLastText } from "@/lib/unitSlip";
import { EntryUnitLabel } from "./EntryUnitLabel";
import { publishRestTimer } from "@/lib/restTimerBus";
import { displayWeights, displayLb, getEntryUnit, kgToLb, lbToKg } from "@/lib/units";
import { useWeightUnit } from "@/lib/useUnit";
import { UnitNumberInput } from "@/components/UnitNumberInput";
import { SetRow } from "./SetRow";
import { RestConnector } from "./RestConnector";
import { RestBanner } from "./RestBanner";
import { CardMenu, type CardMenuItem } from "./CardMenu";
import { AddUnitModal } from "./AddUnitModal";
import { SwapSheet } from "./SwapSheet";
import { rirToEffortTag, TARGET_EFFORT_LABEL } from "@/lib/targetEffort";
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
// NOTE: there is deliberately no "last unit for this exercise" memory. A
// remembered unit seeded the picker for occurrences whose sets carried NO
// equipment_id, so the card displayed a machine the history didn't record —
// and since set rows show no per-set unit, orphans were invisible. Six
// hand-attributions were silently lost to it. The picker now reflects only
// what is stored. See DECISIONS.
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

// A unit as GET /api/equipment returns it — the whole cross-exercise list. The
// picker groups by (matches the selected type?) and (already on this exercise?).
interface SessionUnit {
  id: string;
  label: string;
  equipmentType: string | null;
  gym: string | null;
  builtInWeight: string | null;
  // How this machine's stack is marked ('lb' | 'kg' | null = not recorded).
  stackUnit?: string | null;
  // Stack geometry + this unit's logged loads. All already returned by
  // GET /api/equipment; the type simply didn't admit them. plate_increment and
  // stack_max are NULL on every unit today, which is exactly why the increment
  // falls back to deriving from loggedLoads.
  plateIncrement?: string | null;
  addOnWeight?: string | null;
  stackMax?: string | null;
  loggedLoads?: number[];
  notes: string | null;
  exercises: { exerciseId: string }[];
}

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
  // ALL of the user's units, not just this exercise's (2.12). A unit is a
  // standalone physical machine that many exercises reference (the schema is
  // many-to-many); scoping the picker to one exercise is what forced "+ New
  // unit…" and minted duplicate rows for the same machine (VSL16/VSL13). The
  // picker now groups every unit so an existing machine is one tap away on any
  // exercise, and picking it REUSES the row.
  const [equipmentUnits, setEquipmentUnits] = useState<SessionUnit[]>([]);
  const refreshEquipmentUnits = useCallback(async () => {
    const res = await fetch(`/api/equipment`);
    if (res.ok) setEquipmentUnits(await res.json());
  }, []);
  // The equipment TYPE/unit are stored on this occurrence's logged sets (and
  // restored from the server on hydrate) — a finished session's machine
  // survives a PWA reinstall / localStorage wipe.
  const occStoredType = (sessionSets.find((x) => x.instanceId === ex.instanceId && x.equipmentType)?.equipmentType) as EquipmentTypeId | undefined;
  const occStoredUnit = sessionSets.find((x) => x.instanceId === ex.instanceId && x.equipmentId)?.equipmentId ?? null;
  const [equipTouched, setEquipTouched] = useState(false);
  // ONLY the occurrence's own sets decide the unit. No fallback: an empty
  // picker is the honest answer when nothing is recorded.
  const [equipmentId, setEquipmentId] = useState(() => occStoredUnit ?? UNSPECIFIED_UNIT);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [setType, setSetType] = useState<"warmup" | "working">("working");
  // ── Weight-unit layer (display + entry ONLY — every internal number stays
  // canonical lb; the ONE conversion boundary is canonicalLoad below). With lb
  // selected everything here is the identity, so the card is byte-identical to
  // its pre-unit-layer behavior.
  const [wUnit, toggleWeightUnit] = useWeightUnit();
  // Declared after entryUnit resolves (below) — every weight this card shows for
  // THIS machine renders in the machine's markings when it records them.
  const [load, setLoad] = useState(() =>
    ex.loadType === "bodyweight" ? 0 : getEntryUnit("weight") === "kg" ? lbToKg(45) : 45
  );
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
  // "last" is EXERCISE-level (independent of the selected unit — 2.9); the
  // recalibration note is lane-level (this unit has no history but the exercise
  // does elsewhere). They are decoupled so "last" never vanishes on unit change.
  const [lastText, setLastText] = useState<string | null>(null);
  const [recalNote, setRecalNote] = useState<string | null>(null);
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
  // SSR default first, stored value adopted after mount — the useWeightUnit
  // lesson. Seeding from localStorage during render makes the client's first
  // render disagree with the server's, and React does not patch attribute
  // mismatches: the DOM keeps the server's value while state holds the client's.
  // Unreachable today only because nothing server-renders a card, which is
  // incidental protection, not protection.
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(TAP_HINT_KEY) != null) setHintDismissed(true);
  }, []);
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

  // NO localStorage in this initializer. Reading it during render made the
  // client's first render disagree with the server's, and React does not patch
  // attribute mismatches — the <select> would have kept the server's type while
  // state held the stored one. That is the phantom-unit failure exactly: a
  // selector showing one type while a different one gets written to the set.
  // The stored value is adopted in the effect below instead.
  const [equipType, setEquipType] = useState<EquipmentTypeId>(
    () => (occStoredType && EQUIPMENT_TYPE_BY_ID.has(occStoredType) ? occStoredType : suggestEquipmentType(ex.loadType, ex.exerciseName))
  );
  // The sets may load AFTER mount — restore type/unit once they arrive, unless
  // the user has since picked something (never clobber an in-progress choice).
  // Also the adoption point for the remembered type: same precedence as before
  // (server truth > last used > suggestion), just resolved after hydration
  // rather than during render. `equipTouched` already guards a user pick, so
  // this needs no new state and no change to the card's state machine.
  useEffect(() => {
    (async () => {
      if (equipTouched) return;
      if (occStoredType && EQUIPMENT_TYPE_BY_ID.has(occStoredType)) {
        setEquipType(occStoredType);
      } else {
        const stored = localStorage.getItem(lastTypeKey(ex.exerciseId));
        if (stored && EQUIPMENT_TYPE_BY_ID.has(stored as EquipmentTypeId)) setEquipType(stored as EquipmentTypeId);
      }
      if (occStoredUnit) setEquipmentId(occStoredUnit);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occStoredType, occStoredUnit]);
  const typeDef = EQUIPMENT_TYPE_BY_ID.get(equipType)!;
  const contextBound = typeDef.instanceMatters;
  const resolvedUnitId = contextBound && equipmentId !== "" && equipmentId !== UNSPECIFIED_UNIT ? equipmentId : null;
  const selectedUnit = resolvedUnitId ? equipmentUnits.find((m) => m.id === resolvedUnitId) ?? null : null;
  const lane = laneKey(equipType, resolvedUnitId);
  // Input-boundary only: derived from the already-resolved unit, feeding the
  // load box's label and its one conversion. No lane, offset, timer or drop
  // state is involved.
  // This machine's selectable grid. Presentation-layer only: it snaps what the
  // core suggested onto what the machine can actually select, and never feeds
  // anything back into core. `loggedLoads` is this unit's own history, so the
  // derived increment is per-lane rather than global.
  const num = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
  const grid: GridSpec = {
    storedIncrement: num(selectedUnit?.plateIncrement),
    loggedLoads: selectedUnit?.loggedLoads ?? [],
    addOn: num(selectedUnit?.addOnWeight),
    max: num(selectedUnit?.stackMax),
  };
  const stackMarking = parseStackMarking(selectedUnit?.stackUnit ?? null);
  const entryUnit = resolveWeightUnit(stackMarking, wUnit);
  const unitPinned = stackMarking != null;
  const w = (n: number | string) => (entryUnit === "kg" ? lbToKg(Number(n)) : displayLb(Number(n)));
  // §3 — when this machine's markings differ from the display preference, every
  // weight on THIS card carries both: the machine's unit to set the pin by, and
  // yours to know what it means. Identical units render one value, so the
  // ordinary case stays clean.
  const fmtUnit = (lb: number, u: "lb" | "kg") => String(u === "kg" ? lbToKg(lb) : displayLb(lb));
  const dualWeights = (text: string) =>
    text.replace(/(\d+(?:\.\d+)?) lb/g, (_, n) => formatDualWeight(Number(n), stackMarking, wUnit, fmtUnit));
  // Slip advisory. SKIPPED when a marked unit governs: the box is pinned to the
  // machine's markings, so the slip cannot occur and a warning would be noise.
  // Elsewhere it fires only on the slip's exact shape — the raw number matching
  // history while the converted one doesn't. Advisory only; never blocks a log.
  const [slipDismissed, setSlipDismissed] = useState(false);
  // Load sanity. Advisory, like the slip guard: it asks, it never blocks, and
  // it is silent on every plausible entry. Dismissal is keyed to the value, so
  // correcting the number re-arms it and confirming one absurd load doesn't
  // silence the next.
  const [sanityOk, setSanityOk] = useState<number | null>(null);
  const slip = unitPinned
    ? null
    : detectUnitSlip({
        typed: load,
        canonical: entryUnit === "kg" ? kgToLb(load) : load,
        entryUnit,
        canonicalUnit: "lb",
        recentCanonical: recentLoadsFromLastText(lastText),
      });
  // Changing the effective entry unit re-interprets whatever is in the box, so
  // clear it — the SAME convention the manual unit toggle already uses. Guarded
  // to fire only on a genuine change, never on first resolution.
  const prevEntryUnit = useRef(entryUnit);
  // The slip fix ("Use 120 lb") switches the preference precisely IN ORDER to
  // reinterpret the number already typed, so it must survive the clear below.
  const keepLoadThroughUnitChange = useRef(false);
  useEffect(() => {
    if (prevEntryUnit.current === entryUnit) return;
    prevEntryUnit.current = entryUnit;
    if (keepLoadThroughUnitChange.current) {
      keepLoadThroughUnitChange.current = false;
      return; // the typed number IS the corrected value — keep it
    }
    setLoad(0);
    setDropLoad("");
  }, [entryUnit]);

  // Group the whole unit list for the picker (2.12): this exercise's units of
  // the selected type first, then the rest of that type, then other types —
  // NEVER hidden, so a valid unit is always reachable (the trap that forced
  // "+ New"). Re-computes live when the type changes.
  const unitGroups = useMemo(() => {
    const onThis: SessionUnit[] = [];
    const sameType: SessionUnit[] = [];
    const otherType: SessionUnit[] = [];
    const here = (u: SessionUnit) => u.id === occStoredUnit || u.exercises.some((e) => e.exerciseId === activeExercise.id);
    for (const u of [...equipmentUnits].sort((a, b) => a.label.localeCompare(b.label))) {
      if ((u.equipmentType ?? null) === equipType) (here(u) ? onThis : sameType).push(u);
      else otherType.push(u);
    }
    return { onThis, sameType, otherType };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentUnits, equipType, occStoredUnit, activeExercise.id]);
  const unitOptionLabel = (u: SessionUnit) =>
    `${u.label}${u.gym ? ` · ${u.gym}` : ""}${u.builtInWeight != null ? ` (+${Number(u.builtInWeight)})` : ""}`;

  // Picking a unit REUSES its row. If the unit's own type differs from the
  // current selection, adopt it so the (type, unit) lane stays consistent —
  // this is also what makes an "Other types" unit selectable without breaking.
  //
  // Picking does NOT create the exercise↔unit link. Link-on-pick was tried and
  // reverted: a native dropdown makes a stray selection easy, and every stray
  // pick left a link to go and unlink by hand. Picking is exploratory; LOGGING
  // is the commitment, so POST /api/set-logs is the only writer of the
  // association (onConflictDoNothing). Deliberate linking lives in the
  // equipment sheet's "Used by" (＋ Link an exercise… / Unlink).
  function pickUnit(value: string) {
    setEquipmentId(value);
    setOffsetTouched(false);
    setEquipTouched(true);
    if (value !== UNSPECIFIED_UNIT) {
      const u = equipmentUnits.find((m) => m.id === value);
      if (u?.equipmentType && u.equipmentType !== equipType && EQUIPMENT_TYPE_BY_ID.has(u.equipmentType as EquipmentTypeId)) {
        setEquipType(u.equipmentType as EquipmentTypeId);
        localStorage.setItem(lastTypeKey(activeExercise.id), u.equipmentType);
      }
    }
  }

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
  // Same rule. The effect below already re-derives this whenever type/unit
  // change, so mount is simply its first run — no new state machine, just a
  // start value that both renders agree on.
  const [offsetConfirmed, setOffsetConfirmed] = useState(false);
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
  // THE entry-conversion boundary: what the user typed, in canonical lb.
  //
  // A unit that RECORDS how its stack is marked pins this box to those
  // markings, because the number you read off the pin is a fact about the
  // machine, not a preference. That makes a kg-mode slip structurally
  // impossible on a marked machine — you cannot type 120 at an lb-marked stack
  // and have it stored as 264.55. Unrecorded markings, portable types, and "no
  // unit" all fall back to the global preference, exactly as before.
  const canonicalLoad = entryUnit === "kg" ? kgToLb(load) : load;
  const totalLoad = canonicalLoad + effOffset;
  // Checked on the TOTAL (entered + built-in), because that is the number that
  // lands in the lane's history and feeds every later suggestion. stack_max is
  // NULL on all 18 units today, so in practice only the absolute ceiling fires.
  const sanityWarn = checkLoadSanity(totalLoad, grid.max);
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
  // Anchored to the heaviest WORKING set on this occurrence — the same set the
  // core treats as the top set, so the suggestion steps up from what was
  // actually lifted rather than from the last row entered.
  const topLoggedLoad = loggedSets
    .filter((x) => x.setType === "working")
    .reduce((best, x) => Math.max(best, Number(x.load) || 0), 0);
  const concreteNext = (() => {
    if (progression?.status === "new_machine_baseline") return null;
    if (progression?.signal.type !== "increase_load" || topLoggedLoad <= 0) return null;
    const r = nextSelectableLoad(topLoggedLoad, grid);
    return r.kind === "unknown" ? null : r;
  })();

  // Load the whole unit list (all exercises) so any existing machine is
  // reusable here — the field is always on.
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/equipment`);
      if (res.ok) setEquipmentUnits(await res.json());
    })();
  }, []);

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

  // "last" — the exercise's most recent session across ALL units (scope=exercise).
  // Depends only on the exercise, never the selected lane, so switching units
  // never makes it disappear (2.9).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/exercises/${activeExercise.id}/last-session?scope=exercise`);
      const data: { session: { sets: Array<{ load: number; reps: number }> } | null } = await res.json();
      if (cancelled) return;
      if (data.session && data.session.sets.length > 0) {
        const reps = data.session.sets.map((s) => s.reps).join(", ");
        const load = data.session.sets[0]?.load;
        setLastText(load != null ? `${load} lb × ${reps}` : `× ${reps}`);
      } else {
        setLastText(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeExercise.id]);

  // Recalibration note — lane-level: no history in THIS unit's lane, but the
  // exercise has history on another. Detection unchanged from before; it now
  // drives only its own dismissible chip (never the "last" line).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!lane) {
        setRecalNote(null);
        return;
      }
      const res = await fetch(`/api/exercises/${activeExercise.id}/last-session?lane=${encodeURIComponent(lane)}`);
      const data: { session: { sets: Array<{ load: number; reps: number }> } | null } = await res.json();
      if (cancelled) return;
      if (data.session) {
        setRecalNote(null); // this unit has its own history — no recalibration
        return;
      }
      const any = await fetch(`/api/exercises/${activeExercise.id}/last-session`);
      const anyData: { session: { sets: Array<{ load: number; reps: number }> } | null } = await any.json();
      if (cancelled) return;
      setRecalNote(
        anyData.session
          ? `Recalibrating for this unit — you were at ${anyData.session.sets[0]?.load ?? "?"} lb on another unit (effort + volume carry over)`
          : null
      );
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
      loadEntered: effOffset !== 0 ? canonicalLoad : null,
      builtinOffset: effOffset !== 0 ? effOffset : null,
      reps,
      effort,
      rir: null,
      side: activeExercise.unilateral ? side : null,
      // If the rest timer is running, this set consumes it as an exact rest.
      timedRestSeconds: takeTimedRest(),
    });
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
        // equipmentType is NOT written here — see applyUnitToLoggedSets.
      });
    }
    if (selectedUnit) {
      // /api/equipment/[id] — NOT /api/machines/[id], which the Machines →
      // Equipment rename killed on 2026-07-16. This PATCH 404'd silently for
      // eleven days: the response was never read, so the promise above ("for a
      // named unit it also becomes that unit's stored default") was quietly
      // false the whole time. It caused no divergence only because the offsets
      // that exist were set through the equipment editor instead — luck, not
      // safety. Hence the res.ok check.
      try {
        const res = await fetch(`/api/equipment/${encodeURIComponent(selectedUnit.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ builtInWeight: off }),
        });
        if (!res.ok) {
          setError(`Sets updated, but ${selectedUnit.label} didn't save this as its default (${res.status}).`);
        }
      } catch {
        /* Offline. Each set still carries the offset, so nothing is lost —
           only the unit's default didn't update. Silent by design here. */
      }
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
    const l = entryUnit === "kg" ? kgToLb(Number(dropLoad)) : Number(dropLoad);
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
      // The full equipment snapshot, not just the unit. `equipmentType` was
      // missing here, so a drop segment came out less self-describing than its
      // parent — same machine, same set, but typeless. That also made it
      // invisible to every audit that keys on equipment_type, including the
      // "· no unit" marker (which needs a context-bound type to fire) and the
      // unattributed-sets query. A drop is the same set on the same machine at
      // a lighter load; it inherits the whole snapshot.
      equipmentType: dropFor.equipmentType ?? null,
      equipmentBuiltInWeight: dropFor.equipmentBuiltInWeight ?? null,
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
    setEquipmentId(UNSPECIFIED_UNIT); // a swapped-in exercise has no unit yet
    const storedT = localStorage.getItem(lastTypeKey(c.id));
    setEquipType(storedT && EQUIPMENT_TYPE_BY_ID.has(storedT as EquipmentTypeId) ? (storedT as EquipmentTypeId) : suggestEquipmentType(c.loadType, c.name));
    setSwapOpen(false);
  }
  function resetSwap() {
    setActiveExercise({ id: ex.exerciseId, name: ex.exerciseName, loadType: ex.loadType, portable: ex.portable, unilateral: ex.unilateral });
    setEquipmentId(occStoredUnit ?? UNSPECIFIED_UNIT); // back to what the sets say
    const storedT = localStorage.getItem(lastTypeKey(ex.exerciseId));
    setEquipType(storedT && EQUIPMENT_TYPE_BY_ID.has(storedT as EquipmentTypeId) ? (storedT as EquipmentTypeId) : suggestEquipmentType(ex.loadType, ex.exerciseName));
    setSwapOpen(false);
  }
  // Session-level relabel: naming a unit mid-session reassigns THIS session's
  // sets that sat in the type's unspecified lane. Prior sessions never touched.
  async function relabelSessionSets(unit: EquipmentOption) {
    const toMove = loggedSets.filter((s) => s.equipmentId == null && s.equipmentType === equipType);
    for (const st of toMove) {
      // equipmentType is NOT written — these sets already carry the matching
      // type (it's the filter above); re-asserting it could only overwrite.
      await editSet(st.localId!, { equipmentId: unit.id, equipmentLabel: unit.label });
    }
    if (toMove.length) onSessionChanged();
  }

  // ——— presentation ———
  const swapped = activeExercise.id !== ex.exerciseId;
  const isRecal = recalNote != null;
  // Metadata describes the EXERCISE — it sits under the name as two muted lines
  // (2.9), above the equipment control. "last" always shows (exercise-level;
  // "no prior data" when empty); the source is dropped (the page is already
  // titled by day). The recalibration note stays its own dismissible chip.
  // The target-reference line shows the effort as the 3-level label (not the
  // stale "@ RIR 2") — the target now speaks the same effort scale the session
  // logs. Derived from the stored rir_target via the shared bucket shim.
  const targetTag = rirToEffortTag(ex.target?.rirTarget ?? null);
  const targetText = ex.target
    ? `${ex.target.targetSets} × ${ex.target.repRange ?? "?"}${targetTag ? ` · ${TARGET_EFFORT_LABEL[targetTag]}` : ""}`
    : null;
  // A done card expanded is a REVIEW state, not a greyed logging state: chips
  // + logged rows + rests, fully readable, no input UI. Set rows stay
  // tappable for corrections; un-checking done restores logging.
  const review = completed;
  const equipEditorVisible = !review && (equipOpen ?? loggedSets.length === 0);
  // Option A summary (2.9): the ONE equipment element at rest — "⚙ unit · type"
  // (named) or "⚙ Type · pick unit" (context-bound, no unit yet) or just the
  // type (portable). Tapping reveals full-width labeled Type/Unit fields.
  // The chip reflects the PICKER, which is about to apply to the next set — but
  // it sat above rows that may carry a different unit or none, reading as though
  // it described them all. When the occurrence is only partly attributed, say so
  // ("VSL14 · 2 of 5 sets"); a fully attributed one is unchanged.
  const occSets = sessionSets.filter((x) => x.instanceId === ex.instanceId);
  const onSelected = selectedUnit ? occSets.filter((x) => x.equipmentId === selectedUnit.id).length : 0;
  const partial = selectedUnit != null && occSets.length > 0 && onSelected < occSets.length;
  const equipSummary = selectedUnit
    ? partial
      ? `${selectedUnit.label} · ${onSelected} of ${occSets.length} sets`
      : `${selectedUnit.label} · ${typeDef.label.toLowerCase()}`
    : contextBound
      ? `${typeDef.label} · pick unit`
      : typeDef.label;

  // Re-open a done exercise for editing (revert-to-editable): un-completes THIS
  // occurrence only. The session's finishedAt/firstFinishedAt are never touched,
  // so a finished session stays finished + filed and its History date cannot
  // move. Re-finish = re-check the done box → back to review.
  const menuItems: CardMenuItem[] = [
    ...(review ? [{ label: "Edit exercise", onSelect: () => onToggleComplete(ex.instanceId, false) }] : []),
    { label: "Swap exercise…", onSelect: openSwap },
    ...(swapped ? [{ label: `Undo swap (back to ${ex.exerciseName})`, onSelect: resetSwap }] : []),
    { label: "Move up", onSelect: controls.onMoveUp, disabled: controls.position === 0 },
    { label: "Move down", onSelect: controls.onMoveDown, disabled: controls.position === controls.total - 1 },
    { label: checking ? "Checking progression…" : "Check progression", onSelect: checkProgression, disabled: checking },
    { label: "Remove exercise", onSelect: controls.onRemove, danger: true },
  ];

  // Re-point LOGGED sets to the currently-selected unit (2.11). The equipment
  // dropdown only governs NEW sets; this is the explicit, never-automatic way to
  // move already-logged sets onto the right unit — or to unspecified. It changes
  // ONLY equipmentId; each set's load, entered load, and built-in offset are
  // preserved exactly, so no load ever shifts.
  //
  // equipment_type is deliberately NOT written. It is snapshotted per set and
  // records what the set was PERFORMED on — a fact about history, not about the
  // unit it is now filed under. Re-pointing a set genuinely logged on a cable
  // machine to a selectorized unit must not rewrite its recorded type to
  // "selectorized"; that would silently manufacture history. NULL likewise
  // stays NULL: "not recorded" is not the same as "the new unit's type", and
  // filling it in would be an inference. Only logSet writes the type.
  const repointSets = review
    ? []
    : loggedSets.filter((s) => (s.equipmentId ?? null) !== resolvedUnitId || (s.equipmentType ?? null) !== equipType);
  const repointTargetLabel = selectedUnit?.label ?? (contextBound ? "unspecified" : typeDef.label.toLowerCase());
  async function applyUnitToLoggedSets() {
    for (const st of repointSets) {
      await editSet(st.localId!, {
        equipmentId: resolvedUnitId,
        equipmentLabel: selectedUnit?.label ?? null,
      });
    }
    onSessionChanged();
  }

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
          {/* Metadata under the NAME (2.9): two muted lines describing the
              EXERCISE — above the equipment control. "last" is exercise-level
              (never vanishes on unit change); source dropped. */}
          <div className={styles.metaBlock}>
            <div className={styles.metaLine}>
              <span className={styles.metaLabel}>last</span>{" "}
              {lastText != null ? dualWeights(lastText) : <span className={styles.metaEmpty}>— no prior data</span>}
            </div>
            {targetText && (
              <div className={styles.metaLine}>
                <span className={styles.metaLabel}>target</span> {targetText}
              </div>
            )}
          </div>

          {isRecal && !recalDismissed && (
            <div className={styles.chipsRow}>
              <span className={styles.chipRecal}>
                {displayWeights(String(recalNote), entryUnit)}
                <button type="button" className={styles.chipDismiss} onClick={() => setRecalDismissed(true)} aria-label="Dismiss">✕</button>
              </span>
            </div>
          )}

          {/* Equipment — Option A (2.9): one summary chip at rest; tapping it
              reveals full-width labeled Type/Unit fields (no truncation). */}
          <div className={styles.chipsRow}>
            {review ? (
              // Review: legible, not an editing surface — plain, no toggle.
              <span className={styles.chipUnit}><span aria-hidden="true">⚙</span> {equipSummary}</span>
            ) : (
              <button type="button" className={styles.chipUnit} onClick={() => setEquipOpen(!equipEditorVisible)} title="Equipment for this exercise — tap to change">
                <span aria-hidden="true">⚙</span> {equipSummary} <span aria-hidden="true">{equipEditorVisible ? "▴" : "▾"}</span>
              </button>
            )}
          </div>

          {equipEditorVisible && (
            <div className={styles.equipAttached}>
              <div className={styles.equipField}>
                <span className={styles.equipFieldLabel}>Type</span>
                <select
                  className={styles.selectFull}
                  value={equipType}
                  onChange={(e) => pickType(e.target.value as EquipmentTypeId)}
                  title="How resistance is applied to this set. Pre-selected from the exercise — a visible default, always editable, never hidden."
                >
                  {EQUIPMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              {contextBound && (
                <div className={styles.equipField}>
                  <span className={styles.equipFieldLabel}>Unit</span>
                  <div className={styles.equipUnitRow}>
                    <select
                      className={styles.selectFull}
                      value={equipmentId === "" ? UNSPECIFIED_UNIT : equipmentId}
                      onChange={(e) => pickUnit(e.target.value)}
                      title="Which unit — pick any of your existing machines to reuse it (no duplicate row). The same stack number means different resistance on different units, so each unit tracks its own lane."
                    >
                      <option value={UNSPECIFIED_UNIT}>Unspecified unit</option>
                      {unitGroups.onThis.length > 0 && (
                        <optgroup label="On this exercise">
                          {unitGroups.onThis.map((m) => <option key={m.id} value={m.id}>{unitOptionLabel(m)}</option>)}
                        </optgroup>
                      )}
                      {unitGroups.sameType.length > 0 && (
                        <optgroup label={`Your ${typeDef.label.toLowerCase()} units`}>
                          {unitGroups.sameType.map((m) => <option key={m.id} value={m.id}>{unitOptionLabel(m)}</option>)}
                        </optgroup>
                      )}
                      {unitGroups.otherType.length > 0 && (
                        <optgroup label="Other types">
                          {unitGroups.otherType.map((m) => <option key={m.id} value={m.id}>{m.label}{m.gym ? ` · ${m.gym}` : ""}{m.equipmentType ? ` · ${m.equipmentType}` : ""}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <button type="button" onClick={() => setUnitModalOpen(true)} className={styles.smallBtn} title="Add a new unit for this equipment type">+ New unit…</button>
                  </div>
                </div>
              )}
              {offsetRelevant && (
                <div className={styles.equipRow}>
                  <label title="Constant added weight this equipment contributes (bar, carriage). Pre-filled from the unit/type default; editing here overrides THIS set only — the stored default is unchanged.">
                    + built-in{" "}
                    <UnitNumberInput
                      canonical={offsetInput}
                      onCanonical={(v) => { setOffsetTouched(true); setOffsetInput(v); if (!offsetConfirmed) confirmOffset(Number(v) || 0); }}
                      dimension="weight"
                      unit={entryUnit}
                      className={styles.offsetInput}
                      placeholder={typeDef.defaultOffset == null ? "?" : entryUnit}
                    />
                  </label>
                  {offsetRelevant && !offsetNeedsConfirm && loggedSets.length > 0 && offsetNum !== (occStoredOffset ?? 0) && (
                    <button type="button" onClick={applyOffsetToOccurrence} className={styles.applyAllChip} title="One machine, one offset: apply this built-in to every set of this exercise. Your entered numbers are kept.">
                      apply +{offsetNum}{entryUnit === "kg" ? " lb" : ""} to all {loggedSets.length} set{loggedSets.length === 1 ? "" : "s"}
                    </button>
                  )}
                  {offsetRelevant && typeDef.defaultOffset == null && offsetInput.trim() === "" && (
                    <span className={styles.warnNote} title="Plate-loaded carriage/handle weight is unit-specific — set it rather than guessing. Until then, loads record what you put on.">
                      carriage weight unknown — set it
                    </span>
                  )}
                </div>
              )}
              {repointSets.length > 0 && (
                <div className={styles.equipRow}>
                  <button
                    type="button"
                    onClick={applyUnitToLoggedSets}
                    className={styles.applyAllChip}
                    title="Re-points these already-logged sets to the selected unit. Logged loads are unchanged — only the unit label moves."
                  >
                    Move {repointSets.length} logged set{repointSets.length === 1 ? "" : "s"} → {repointTargetLabel}
                  </button>
                  <span className={styles.equipHint}>loads unchanged — only the unit moves</span>
                </div>
              )}
            </div>
          )}

          {unitModalOpen && (
            <AddUnitModal
              exerciseId={activeExercise.id}
              presetType={equipType}
              existingUnits={equipmentUnits}
              onClose={() => setUnitModalOpen(false)}
              onCreated={(unit) => {
                setUnitModalOpen(false);
                // Optimistic add (refresh reloads the accurate list right after).
                setEquipmentUnits((us) =>
                  us.some((u) => u.id === unit.id)
                    ? us
                    : [...us, { id: unit.id, label: unit.label, equipmentType: equipType, gym: null, builtInWeight: unit.builtInWeight, notes: unit.notes, exercises: [{ exerciseId: activeExercise.id }] }]
                );
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
                  {i > 0 && !isDrop && (
                    <RestConnector
                      restSeconds={s.restSeconds ?? null}
                      restSource={s.restSource ?? null}
                      onSave={async (sec) => { await editSet(s.localId!, { restSeconds: sec, restSource: "user" }); onSessionChanged(); }}
                    />
                  )}
                  <SetRow
                    weightUnit={entryUnit}
                    secondaryUnit={stackMarking != null && stackMarking !== wUnit ? wUnit : undefined}
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
                        <NumberInput value={dropLoad} onChange={setDropLoad} placeholder={entryUnit} autoFocus style={{ width: 64 }} />
                        <span>×</span>
                        <NumberInput value={String(dropReps)} onChange={(v) => setDropReps(Number(v || 0))} style={{ width: 52 }} maxIntDigits={INT_DIGITS.reps} allowDecimal={false} />
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
                    {progression.signal.type === "increase_load" && progression.signal.suggestedLoad != null ? ` (try ${w(progression.signal.suggestedLoad)} ${entryUnit})` : ""}
                  </span>
                  {/* The concrete step, snapped to what this machine can select.
                      Rendered BESIDE the core's wording, never replacing it —
                      core keeps saying what it decided, this says what to pin.
                      Absent whenever no increment resolves, which is every
                      bodyweight lane and any lane with under three distinct
                      loads. */}
                  {concreteNext && (
                    <div className={styles.progConcrete}>
                      {concreteNext.kind === "at_max"
                        ? `${selectedUnit?.label ?? "This stack"} is topped out at ${w(concreteNext.max)} ${entryUnit} — add reps, a pause, or a harder variation instead.`
                        : `Try ${w(concreteNext.load)} ${entryUnit} — the next selectable load on ${selectedUnit?.label ?? "this stack"}${concreteNext.source === "history" ? ` (${w(concreteNext.increment)} ${entryUnit} steps, from your logs)` : ""}.`}
                    </div>
                  )}
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
                  <strong>{w(totalLoad)} {entryUnit}</strong>
                  <span className={styles.setSuffix}> · {w(canonicalLoad)} + {w(effOffset)} built-in</span>
                </span>
              )}
              {offsetNeedsConfirm && (
                <button type="button" onClick={() => confirmOffset(offsetNum)} className={styles.confirmChip} title="A default offset is suggested but NOT applied until you confirm it — a wrong offset silently corrupts every set.">
                  apply +{offsetNum}{entryUnit === "kg" ? " lb" : ""} {typeDef.label.toLowerCase()}? ✓
                </button>
              )}
            </div>
            <div className={styles.entryGrid} style={{ marginTop: 8 }}>
              <label className={styles.cell}>
                <span className={styles.cellLabel}>
                  <EntryUnitLabel
                    unit={entryUnit}
                    canonicalUnit="lb"
                    pinned={unitPinned}
                    label={ex.loadType === "bodyweight" ? "added" : undefined}
                  />
                </span>
                <NumberInput className={styles.cellInput} value={String(load)} onChange={(v) => setLoad(Number(v || 0))} title={ex.loadType === "bodyweight" ? "Added weight (0 = bodyweight)" : "Load"} />
              </label>
              <label className={styles.cell}>
                <span className={styles.cellLabel}>reps</span>
                <NumberInput className={styles.cellInput} value={String(reps)} onChange={(v) => setReps(Number(v || 0))} title="Reps" maxIntDigits={INT_DIGITS.reps} allowDecimal={false} />
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
            {sanityWarn && sanityOk !== totalLoad && (
              <div className={styles.slipWarn}>
                <span>
                  <strong>{w(totalLoad)} {entryUnit}</strong> is above {selectedUnit?.label ?? "this machine"}&rsquo;s{" "}
                  {w(sanityWarn.stackMax)} {entryUnit} stack. Sure?
                </span>
                <span className={styles.slipWarnActions}>
                  <button type="button" className={styles.unitConfirmNo} onClick={() => setSanityOk(totalLoad)}>
                    Yes, log it
                  </button>
                </span>
              </div>
            )}
            {slip && !slipDismissed && (
              <div className={styles.slipWarn}>
                <span>
                  You entered <strong>{slip.typed} {slip.entryUnit}</strong> = {Math.round(slip.canonical)} lb. Recent{" "}
                  {activeExercise.name} is ~{slip.typical} lb. Did you mean {slip.typed} lb?
                </span>
                <span className={styles.slipWarnActions}>
                  <button
                    type="button"
                    className={styles.unitConfirmYes}
                    // The ONE sanctioned inline preference change. Being in the
                    // wrong mode IS the fault here, so leaving it is the fix —
                    // and unlike the old tap-the-label toggle this is an
                    // explicitly labelled correction, not a stray tap. It says
                    // so on the button rather than changing a global setting
                    // quietly. See DECISIONS.
                    title="Switches your weight preference back to lb and keeps the number you typed"
                    onClick={() => { keepLoadThroughUnitChange.current = true; toggleWeightUnit(); setSlipDismissed(true); }}
                  >
                    Use {slip.typed} lb · switch to lb
                  </button>
                  <button type="button" className={styles.unitConfirmNo} onClick={() => setSlipDismissed(true)}>
                    Log {Math.round(slip.canonical)} lb
                  </button>
                </span>
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
