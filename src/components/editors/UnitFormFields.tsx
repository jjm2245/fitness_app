"use client";

import styles from "./editors.module.css";
import { UnitNumberInput } from "@/components/UnitNumberInput";
import { useWeightUnit } from "@/lib/useUnit";

// THE unit form — one component for both places a unit is created or edited:
// the Equipment section (generic add/edit, Type is a picker) and the session's
// "New … unit" sheet (Type is supplied by the flow, so it's hidden). Grouped by
// function so the load-math fields are findable:
//   1 Identity    — Label, Type (when applicable)
//   2 Load math   — Built-in weight, Pulley (with a hint: these affect loads)
//   3 Provenance  — Gym / location, Manufacturer, Model
//   4 Notes       — Description
export interface UnitDraft {
  label: string;
  equipmentType: string;
  builtInWeight: string; // canonical lb, "" = UNKNOWN (never 0 — see below)
  pulleyRatioKind: string;
  gym: string;
  brand: string;
  model: string;
  notes: string;
}

export const EQUIPMENT_UNIT_TYPES = ["", "selectorized", "plate_loaded", "cable", "smith", "other"];
const PULLEY_KINDS = ["unknown", "1:1", "2:1", "other"];

export function emptyUnitDraft(over: Partial<UnitDraft> = {}): UnitDraft {
  return {
    label: "",
    equipmentType: "",
    // Empty = UNKNOWN, never 0. Zero is a CLAIM that the machine adds nothing,
    // which is usually false for plate-loaded/smith units and would silently
    // understate every set logged on it.
    builtInWeight: "",
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
}: {
  draft: UnitDraft;
  onChange: (patch: Partial<UnitDraft>) => void;
  // Hidden when the context already knows the type (the session flow's
  // "New selectorized machine unit"); shown in the generic equipment add.
  showType?: boolean;
  autoFocusLabel?: boolean;
}) {
  const [wUnit] = useWeightUnit();

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

      {/* ── 2. Load math — grouped, because these two are the fields that
             change what a logged set means. ── */}
      <div className={styles.formGroup}>
        <span className={styles.fieldLabel}>Load math</span>
        <div className={styles.fieldRow}>
          <label className={styles.fieldHalf}>
            <span className={styles.fieldLabel}>Built-in {wUnit}</span>
            <UnitNumberInput
              canonical={draft.builtInWeight}
              onCanonical={(v) => onChange({ builtInWeight: v })}
              dimension="weight"
              className={styles.fieldInput}
              placeholder="unknown"
            />
          </label>
          <label className={styles.fieldHalf}>
            <span className={styles.fieldLabel}>Pulley</span>
            <select className={styles.fieldInput} value={draft.pulleyRatioKind} onChange={(e) => onChange({ pulleyRatioKind: e.target.value })}>
              {PULLEY_KINDS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <span className={styles.fieldNote}>
          Built-in weight (bar, handles, carriage) is added to every load you log on this unit. Leave it blank if you
          don&rsquo;t know it — blank means unknown, not zero. Pulley ratio is recorded for interpretation only and never
          changes a logged load.
        </span>
      </div>

      {/* ── 3. Provenance ── */}
      <div className={styles.formGroup}>
        <span className={styles.fieldLabel}>Where it is</span>
        {/* Gym gets its own row — it's the longest value and the one that
            actually disambiguates two units with the same label. */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Gym / location</span>
          <input className={styles.fieldInput} value={draft.gym} onChange={(e) => onChange({ gym: e.target.value })} />
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

      {/* ── 4. Notes ── */}
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
