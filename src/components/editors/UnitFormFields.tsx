"use client";

import { useState } from "react";
import styles from "./editors.module.css";
import { UnitNumberInput } from "@/components/UnitNumberInput";
import { useWeightUnit } from "@/lib/useUnit";
import { formatForUnit } from "@/lib/units";
import { suggestPlateIncrement, selectableLoads, formatSelectableLoads, parseStackMarking, resolveWeightUnit } from "@/lib/stack";

// THE unit form — one component for both places a unit is created or edited:
// the Equipment section (generic add/edit, Type is a picker) and the session's
// "New … unit" sheet (Type is supplied by the flow, so it's hidden). Grouped by
// function:
//   1 Identity   — Label, Type (when applicable)
//   2 Load       — built-in weight: the ONE field that enters a logged number
//   3 Stack      — increment / add-on / max / pulley: what loads are SELECTABLE
//   4 Where      — Gym (dropdown), Manufacturer, Model
//   5 Notes      — Description
//
// The Load/Stack split is the important one: everything in Load changes what a
// set MEANS, and nothing in Stack ever does. Keeping them apart is what stops
// someone entering the plate size into the field that gets added to their sets.
export interface UnitDraft {
  label: string;
  equipmentType: string;
  builtInWeight: string; // canonical lb, "" = UNKNOWN (never 0 — see below)
  plateIncrement: string;
  addOnWeight: string;
  stackMax: string;
  stackUnit: string; // 'lb' | 'kg' | '' — '' = not recorded (falls back to preference)
  pulleyRatioKind: string;
  gym: string;
  brand: string;
  model: string;
  notes: string;
}

export const EQUIPMENT_UNIT_TYPES = ["", "selectorized", "plate_loaded", "cable", "smith", "other"];
const PULLEY_KINDS = ["unknown", "1:1", "2:1", "other"];
const ADD_NEW_GYM = "__add_new_gym__";

export function emptyUnitDraft(over: Partial<UnitDraft> = {}): UnitDraft {
  return {
    label: "",
    equipmentType: "",
    // Empty = UNKNOWN, never 0. Zero is a CLAIM that the machine adds nothing,
    // which is usually false for plate-loaded/smith units and would silently
    // understate every set logged on it.
    builtInWeight: "",
    plateIncrement: "",
    addOnWeight: "",
    stackMax: "",
    stackUnit: "", // not recorded
    pulleyRatioKind: "unknown",
    gym: "",
    brand: "",
    model: "",
    notes: "",
    ...over,
  };
}

export function UnitFormFields({
  draft,
  onChange,
  showType = true,
  autoFocusLabel = false,
  knownGyms = [],
  loggedLoads = [],
}: {
  draft: UnitDraft;
  onChange: (patch: Partial<UnitDraft>) => void;
  // Hidden when the context already knows the type (the session flow's
  // "New selectorized machine unit"); shown in the generic equipment add.
  showType?: boolean;
  autoFocusLabel?: boolean;
  // Distinct gym values already in use — the dropdown's options. Free text is
  // why one gym became "Monroe PF" ×17 and "MonroePF" ×2.
  knownGyms?: string[];
  // This unit's distinct logged loads, for the increment suggestion.
  loggedLoads?: number[];
}) {
  const [wUnit] = useWeightUnit();
  // The stack's markings are a property of the MACHINE — the plates are stamped
  // in one unit — so a RECORDED marking overrides the global lb/kg preference
  // for these three fields. Not recorded (NULL) falls back to the preference,
  // exactly as before markings existed. Storage stays canonical lb either way;
  // this is entry/display only.
  const marking = parseStackMarking(draft.stackUnit);
  const sUnit = resolveWeightUnit(marking, wUnit);
  // A gym not in the known list (or a brand-new unit with none) starts in
  // free-text mode so nothing is ever silently coerced to a wrong existing gym.
  const [gymFreeText, setGymFreeText] = useState(
    () => draft.gym !== "" && !knownGyms.includes(draft.gym)
  );
  // ── Type scoping. Same rule throughout: a field appears where it MEANS
  // something. Hidden values are hidden, never cleared — dropping stored data
  // to match a display rule would be the tail wagging the dog.
  //
  // Add-on and max are WEIGHT-STACK concepts — a selector pin has a lever and a
  // ceiling. On plate-loaded and Smith you hang plates: there is no lever to
  // add, and no stack to run out of.
  const hasWeightStack = draft.equipmentType === "selectorized" || draft.equipmentType === "cable";
  // Pulley rides the SAME rule: many selectorized machines are cable-driven
  // internally, and the twelve-inch pull test works on any visible stack. It
  // stays out on plate-loaded and Smith, where a ratio is a category error
  // rather than a withheld capability.
  const showPulley = hasWeightStack;
  // Plate increment survives on every loaded type: on a stack it's the plate
  // size, on plate-loaded or Smith it's the smallest plate you can add. Only
  // bodyweight-ish units (no type set / "other") have nothing to say.
  const hasLoadedIncrement = hasWeightStack || draft.equipmentType === "plate_loaded" || draft.equipmentType === "smith";
  const showStack = hasLoadedIncrement;
  // Built-in is scoped more GENTLY than the stack fields: it is typically only
  // nonzero on plate-loaded and Smith, but it is genuinely possible elsewhere —
  // a stack can have a starting resistance, and an assisted machine records its
  // assist as a NEGATIVE built-in (the capability we relied on when dropping
  // counterweight_lb). So it stays on every loaded type and only disappears
  // where a per-unit carriage is meaningless: portable types, where the number
  // you log IS the weight.
  const showBuiltIn = hasLoadedIncrement;
  const suggestion = suggestPlateIncrement(loggedLoads);
  // §2b — show the OUTPUT of the three fields. Explaining "plate size" in words
  // is weaker than showing the grid it produces, and a wrong entry makes an
  // obviously wrong preview, so this doubles as validation.
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  // Only a weight stack has a grid to preview. On plate-loaded/Smith the add-on
  // and max fields are HIDDEN, and deriving a visible line from fields the user
  // can't see would be the phantom-unit mistake again — showing output from
  // input they have no way to inspect or correct.
  const grid = hasWeightStack
    ? selectableLoads(num(draft.plateIncrement), num(draft.addOnWeight), num(draft.stackMax))
    : [];
  const gridLine = formatSelectableLoads(grid, sUnit, (lb) => formatForUnit(String(lb), sUnit, "weight"));

  return (
    <>
      {/* ── 1. Identity ── */}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Label</span>
        <input
          className={styles.fieldInput}
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder='e.g. "leg ext by the mirror"'
          autoFocus={autoFocusLabel}
        />
      </div>
      {showType && (
        <div className={styles.field} style={{ marginTop: 10 }}>
          <span className={styles.fieldLabel}>Type</span>
          <select className={styles.fieldInput} value={draft.equipmentType} onChange={(e) => onChange({ equipmentType: e.target.value })}>
            {EQUIPMENT_UNIT_TYPES.map((t) => (
              <option key={t} value={t}>{t === "" ? "type…" : t}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── The marking governs BOTH groups below, so it sits above both. A
             control that decides the unit of two sections can't live inside
             one of them — and it belongs beside Type, since both state facts
             about the machine rather than preferences of the user. Compact
             row, not a section header: it's one field. ── */}
      {(showBuiltIn || showStack) && (
        <label className={styles.field} style={{ marginTop: 10 }}>
          <span className={styles.fieldLabel}>Weights marked in</span>
          <select
            className={styles.fieldInput}
            value={marking ?? ""}
            onChange={(e) => onChange({ stackUnit: e.target.value })}
          >
            <option value="">not recorded</option>
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
          <span className={styles.fieldNote}>
            How this machine&rsquo;s weights are marked — the carriage or starting resistance below, and its plates.
            Recording it states a fact about the machine, so it governs every weight on this unit and pins the weight
            box when you log here, matching the markings you&rsquo;re reading. Left unrecorded, your display preference
            governs as usual.
          </span>
        </label>
      )}

      {/* ── 2. Load — the only field here that enters a logged number ── */}
      {showBuiltIn && (
      <div className={styles.formGroup}>
        <span className={styles.fieldLabel}>Load</span>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Built-in {sUnit}
            {marking != null && <span className={styles.markedTag}> · marked</span>}
          </span>
          <UnitNumberInput
            canonical={draft.builtInWeight}
            onCanonical={(v) => onChange({ builtInWeight: v })}
            dimension="weight"
            unit={sUnit}
            // Assisted machines carry a NEGATIVE built-in — the counterweight
            // subtracts from what you lift — so this is the one weight field
            // where a leading minus has to survive the mask.
            allowNegative
            className={styles.fieldInput}
            placeholder="unknown"
          />
        </label>
        <span className={styles.fieldNote}>
          {hasWeightStack
            ? "Usually 0 — set it only if this machine has a starting resistance. An assisted machine records its assist as a negative number."
            : "The weight of the empty carriage or bar, added to every load you log here."}{" "}
          Leave blank if you don&rsquo;t know it — blank means unknown, not zero.
        </span>
      </div>
      )}

      {/* ── 3. Stack — what the machine can SELECT. None of this enters a load. ── */}
      {showStack && (
      <div className={styles.formGroup}>
        <span className={styles.fieldLabel}>{hasWeightStack ? "Stack" : "Plates"}</span>
        <div className={styles.fieldRow} style={{ marginTop: 8 }}>
          <label className={styles.fieldHalf}>
            <span className={styles.fieldLabel}>Plate size {sUnit}</span>
            <UnitNumberInput
              canonical={draft.plateIncrement}
              onCanonical={(v) => onChange({ plateIncrement: v })}
              dimension="weight"
              unit={sUnit}
              className={styles.fieldInput}
              placeholder="—"
            />
          </label>
          {hasWeightStack && (
            <>
              <label className={styles.fieldHalf}>
                <span className={styles.fieldLabel}>Add-on lever {sUnit}</span>
                <UnitNumberInput
                  canonical={draft.addOnWeight}
                  onCanonical={(v) => onChange({ addOnWeight: v })}
                  dimension="weight"
                  unit={sUnit}
                  className={styles.fieldInput}
                  placeholder="—"
                />
              </label>
              <label className={styles.fieldHalf}>
                <span className={styles.fieldLabel}>Max load {sUnit}</span>
                <UnitNumberInput
                  canonical={draft.stackMax}
                  onCanonical={(v) => onChange({ stackMax: v })}
                  dimension="weight"
                  unit={sUnit}
                  className={styles.fieldInput}
                  placeholder="—"
                />
              </label>
            </>
          )}
        </div>
        {/* A lower bound derived from real logs — offered, never applied, and
            withdrawn once the field has an answer. A suggestion that lingers
            beside a filled field reads as a correction rather than an offer. */}
        {suggestion != null && draft.plateIncrement.trim() === "" && (
          <button
            type="button"
            className={styles.quietBtn}
            style={{ marginTop: 6, alignSelf: "flex-start" }}
            onClick={() => onChange({ plateIncrement: String(suggestion) })}
          >
            {/* Stated in the ACTIVE unit — the value stored is canonical lb
                either way, but a "10 lb" hint beside kg fields reads as a
                contradiction. */}
            Suggested from your logs: {formatForUnit(String(suggestion), sUnit, "weight")} {sUnit}
          </button>
        )}
        {showPulley && (
          <label className={styles.field} style={{ marginTop: 8 }}>
            <span className={styles.fieldLabel}>Pulley</span>
            <select className={styles.fieldInput} value={draft.pulleyRatioKind} onChange={(e) => onChange({ pulleyRatioKind: e.target.value })}>
              {PULLEY_KINDS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <span className={styles.fieldNote}>
          {hasWeightStack ? (
            <>
              <strong>Plate size</strong> — the weight of one plate on this stack.{" "}
              <strong>Add-on lever</strong> — extra weight the lever adds <em>when engaged</em>, which is what lets you
              select in-between loads; it is not weight that&rsquo;s always applied.{" "}
              <strong>Max load</strong> — the top of the stack.
            </>
          ) : (
            <>
              <strong>Plate size</strong> — the smallest plate you can add here.
            </>
          )}{" "}
          These drive suggestions only — they never change a stored load.
        </span>
        {gridLine && (
          <span className={styles.fieldNote} style={{ marginTop: 4 }}>
            Selectable: {gridLine}
          </span>
        )}
      </div>
      )}

      {/* ── 4. Where it is ── */}
      <div className={styles.formGroup}>
        <span className={styles.fieldLabel}>Where it is</span>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Gym / location</span>
          {gymFreeText ? (
            <>
              <input
                className={styles.fieldInput}
                value={draft.gym}
                onChange={(e) => onChange({ gym: e.target.value })}
                placeholder="New gym name"
                autoFocus
              />
              {knownGyms.length > 0 && (
                <button
                  type="button"
                  className={styles.quietBtn}
                  style={{ marginTop: 6, alignSelf: "flex-start" }}
                  onClick={() => { setGymFreeText(false); onChange({ gym: knownGyms[0] }); }}
                >
                  Pick an existing gym instead
                </button>
              )}
            </>
          ) : (
            <select
              className={styles.fieldInput}
              value={draft.gym}
              onChange={(e) => {
                if (e.target.value === ADD_NEW_GYM) { setGymFreeText(true); onChange({ gym: "" }); return; }
                onChange({ gym: e.target.value });
              }}
            >
              {/* No placeholder ROW: the field label already says what this is,
                  so prompt text in the list is redundant. `hidden` keeps the
                  empty value matchable — an unset gym renders blank — while
                  keeping it out of the options the user can pick. */}
              {draft.gym === "" && <option value="" hidden />}
              {knownGyms.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value={ADD_NEW_GYM}>Add new gym…</option>
            </select>
          )}
        </label>
        <div className={styles.fieldRow} style={{ marginTop: 8 }}>
          <label className={styles.fieldHalf}>
            <span className={styles.fieldLabel}>Manufacturer</span>
            <input className={styles.fieldInput} value={draft.brand} onChange={(e) => onChange({ brand: e.target.value })} />
          </label>
          <label className={styles.fieldHalf}>
            <span className={styles.fieldLabel}>Model</span>
            <input className={styles.fieldInput} value={draft.model} onChange={(e) => onChange({ model: e.target.value })} />
          </label>
        </div>
      </div>

      {/* ── 5. Notes ── */}
      <div className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Description</span>
        <textarea
          className={styles.fieldArea}
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="quirks, cam feel, serial…"
          rows={2}
        />
      </div>
    </>
  );
}
