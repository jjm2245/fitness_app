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
export function AddUnitModal({ exerciseId, presetType, onClose, onCreated }: {
  exerciseId: string;
  presetType: EquipmentTypeId;
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

  async function create() {
    if (!label.trim() || busy) return;
    setBusy(true);
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `u_${Date.now().toString(36)}`;
    const unit: EquipmentOption = { id, label: label.trim(), builtInWeight: offset.trim() !== "" ? offset.trim() : null, notes: notes.trim() || null };
    try {
      await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id, label: label.trim(), equipmentType: presetType, gym: gym.trim() || null, brand: brand.trim() || null,
          builtInWeight: offset.trim() !== "" ? Number(offset) : null, pulleyRatioKind: ratio, notes: notes.trim() || null,
        }),
      });
    } catch {
      /* offline — the next set's sync auto-registers id+label+type+offset */
    }
    setBusy(false);
    onCreated(unit); // optimistic: selected immediately, offline included
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
      <div className={styles.finishActions}>
        <button type="button" onClick={create} disabled={busy || !label.trim()} className={styles.logBtn}>
          Add unit
        </button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
