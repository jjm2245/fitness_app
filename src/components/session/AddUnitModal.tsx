"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import { EQUIPMENT_TYPE_BY_ID, type EquipmentTypeId } from "@/lib/equipment";
import type { EquipmentOption } from "./shared";

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
  const [label, setLabel] = useState("");
  const [gym, setGym] = useState("");
  const [brand, setBrand] = useState("");
  const [offset, setOffset] = useState("");
  const [ratio, setRatio] = useState("unknown");
  const [notes, setNotes] = useState("");
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
      <input
        className={styles.unitField}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder='Label — e.g. "leg ext by the mirror"'
        autoFocus
      />
      <div className={styles.unitFieldRow}>
        <input className={styles.unitField} value={gym} onChange={(e) => setGym(e.target.value)} placeholder="Gym / location" />
        <input className={styles.unitField} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Manufacturer" />
      </div>
      <div className={styles.unitFieldRow}>
        <label className={styles.unitInlineLabel}>
          built-in lb
          <input
            type="number"
            className={styles.offsetInput}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            placeholder={typeDef?.defaultOffset == null ? "?" : String(typeDef?.defaultOffset)}
          />
        </label>
        <label className={styles.unitInlineLabel} title="Captured for interpretation only — a ratio cancels out of every lane-scoped comparison, so it is NEVER folded into the logged load.">
          pulley
          <select className={styles.selectQuiet} value={ratio} onChange={(e) => setRatio(e.target.value)}>
            <option value="unknown">unknown</option>
            <option value="1:1">1:1</option>
            <option value="2:1">2:1</option>
            <option value="other">other</option>
          </select>
        </label>
      </div>
      <textarea
        className={styles.unitNotes}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Description — quirks, cam feel, serial…"
        rows={3}
      />
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
