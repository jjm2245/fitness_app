"use client";

import { useState } from "react";
import styles from "./session.module.css";
import { EQUIPMENT_TYPE_BY_ID, type EquipmentTypeId } from "@/lib/equipment";
import type { EquipmentOption } from "./shared";

// Add-equipment modal (3d) — moved verbatim from the log page (phase 2 keeps
// it a centered modal by owner instruction: "unchanged behavior"). Full unit
// fields captured mid-session without leaving the log. The entered offset
// becomes the unit's stored default.
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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--raised)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 16, width: "min(420px, 92vw)", display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <strong>New {EQUIPMENT_TYPE_BY_ID.get(presetType)?.label.toLowerCase()} unit</strong>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='label, e.g. "leg ext by the mirror"' autoFocus style={{ minWidth: 0, width: "100%", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
          <input value={gym} onChange={(e) => setGym(e.target.value)} placeholder="gym / location" style={{ flex: 1, minWidth: 0 }} />
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="manufacturer" style={{ flex: 1, minWidth: 0 }} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
          <label>built-in lb{" "}
            <input type="number" value={offset} onChange={(e) => setOffset(e.target.value)} placeholder={EQUIPMENT_TYPE_BY_ID.get(presetType)?.defaultOffset == null ? "?" : String(EQUIPMENT_TYPE_BY_ID.get(presetType)?.defaultOffset)} style={{ width: 64 }} />
          </label>
          <label>pulley{" "}
            <select value={ratio} onChange={(e) => setRatio(e.target.value)} title="Captured for interpretation only — a ratio cancels out of every lane-scoped comparison, so it is NEVER folded into the logged load.">
              <option value="unknown">unknown</option>
              <option value="1:1">1:1</option>
              <option value="2:1">2:1</option>
              <option value="other">other</option>
            </select>
          </label>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="description — quirks, cam feel, serial…" rows={2} style={{ resize: "vertical", fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className={styles.smallBtn}>Cancel</button>
          <button type="button" onClick={create} disabled={busy || !label.trim()} className={styles.logBtn} style={{ width: "auto", minHeight: 44, padding: "0 18px" }}>Add unit</button>
        </div>
      </div>
    </div>
  );
}
