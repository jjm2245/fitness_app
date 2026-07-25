"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import { EQUIPMENT_TYPE_BY_ID, type EquipmentTypeId } from "@/lib/equipment";
import type { EquipmentOption } from "./shared";
import { UnitFormFields, emptyUnitDraft, type UnitDraft } from "@/components/editors/UnitFormFields";

// New-unit entry (2.5-11: now a bottom sheet on the Sheet primitive, fields
// on the design tokens — it was the last centered modal, visibly unstyled).
// Fields and behavior unchanged: full unit captured mid-session without
// leaving the log; the entered offset becomes the unit's stored default.
// A minimal shape of the existing units, for dedupe matching.
interface ExistingUnit {
  id: string;
  label: string;
  equipmentType: string | null;
  gym: string | null;
  builtInWeight: string | null;
  notes: string | null;
}

export function AddUnitModal({ exerciseId, presetType, existingUnits = [], onClose, onCreated }: {
  exerciseId: string;
  presetType: EquipmentTypeId;
  existingUnits?: ExistingUnit[];
  onClose: () => void;
  onCreated: (unit: EquipmentOption) => void;
}) {
  // ONE shared draft/form with the equipment section — the type is supplied by
  // this flow ("New selectorized machine unit"), so its picker stays hidden.
  const [d, setD] = useState<UnitDraft>(() => emptyUnitDraft({ equipmentType: presetType }));
  const set = (patch: Partial<UnitDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const label = d.label, gym = d.gym, brand = d.brand, offset = d.builtInWeight, ratio = d.pulleyRatioKind, notes = d.notes;
  const [busy, setBusy] = useState(false);
  // Dedupe (2.12): a match on label + type + gym (case-insensitive label; gym
  // is part of identity — the same label at two gyms is two machines). We
  // OFFER the existing one, never silently redirect.
  const [dupe, setDupe] = useState<ExistingUnit | null>(null);

  function findExisting(): ExistingUnit | null {
    const l = label.trim().toLowerCase();
    const g = gym.trim().toLowerCase();
    return (
      existingUnits.find(
        (u) => u.label.trim().toLowerCase() === l && (u.equipmentType ?? null) === presetType && (u.gym ?? "").trim().toLowerCase() === g
      ) ?? null
    );
  }

  // POST with a GIVEN id: a fresh uuid mints a new row; an existing unit's id
  // is a no-op insert + this-exercise association (onConflictDoNothing) — i.e.
  // reuse. Either way the unit is associated and returned for selection.
  async function post(id: string, existing?: ExistingUnit) {
    setBusy(true);
    const unit: EquipmentOption = existing
      ? { id: existing.id, label: existing.label, builtInWeight: existing.builtInWeight, notes: existing.notes }
      : { id, label: label.trim(), builtInWeight: offset.trim() !== "" ? offset.trim() : null, notes: notes.trim() || null };
    try {
      await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? { id: existing.id, label: existing.label }
            : {
                id, label: label.trim(), equipmentType: presetType, gym: gym.trim() || null, brand: brand.trim() || null,
                model: d.model.trim() || null,
                builtInWeight: offset.trim() !== "" ? Number(offset) : null, pulleyRatioKind: ratio, notes: notes.trim() || null,
              }
        ),
      });
    } catch {
      /* offline — the next set's sync auto-registers id+label+type+offset */
    }
    setBusy(false);
    onCreated(unit); // optimistic: selected immediately, offline included
  }

  async function create() {
    if (!label.trim() || busy) return;
    const match = findExisting();
    if (match) { setDupe(match); return; } // offer reuse first, never silent
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `u_${Date.now().toString(36)}`;
    await post(id);
  }

  const typeDef = EQUIPMENT_TYPE_BY_ID.get(presetType);

  return (
    <Sheet title={`New ${typeDef?.label.toLowerCase()} unit`} onClose={onClose}>
      <UnitFormFields draft={d} onChange={set} showType={false} autoFocusLabel />

      {dupe ? (
        <div className={styles.warnBox} style={{ marginTop: 4 }}>
          <p>
            You already have <strong>{dupe.label}</strong>
            {dupe.gym ? <> at <strong>{dupe.gym}</strong></> : null} — reuse it instead of making a duplicate?
          </p>
          <div className={styles.finishActions} style={{ marginTop: 10 }}>
            <button type="button" onClick={() => post(dupe.id, dupe)} disabled={busy} className={styles.logBtn}>
              Use {dupe.label}
            </button>
            <button
              type="button"
              onClick={() => { setDupe(null); const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `u_${Date.now().toString(36)}`; void post(id); }}
              disabled={busy}
            >
              Create anyway
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.finishActions}>
          <button type="button" onClick={create} disabled={busy || !label.trim()} className={styles.logBtn}>
            Add unit
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      )}
    </Sheet>
  );
}
