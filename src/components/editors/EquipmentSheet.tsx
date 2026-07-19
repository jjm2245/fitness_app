"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import styles from "./editors.module.css";

export interface EquipmentUnit {
  id: string;
  label: string;
  gym: string | null;
  brand: string | null;
  model: string | null;
  builtInWeight: string | null;
  equipmentType: string | null;
  pulleyRatioKind: string;
  notes: string | null;
  exercises: Array<{ exerciseId: string; name: string }>;
  loggedCount: number;
}

export const EQUIPMENT_UNIT_TYPES = ["", "selectorized", "plate_loaded", "cable", "smith", "other"];
const PULLEY_KINDS = ["unknown", "1:1", "2:1", "other"];

interface Draft {
  label: string;
  gym: string;
  brand: string;
  model: string;
  builtInWeight: string;
  equipmentType: string;
  pulleyRatioKind: string;
  notes: string;
}

function toDraft(m?: EquipmentUnit): Draft {
  return {
    label: m?.label ?? "",
    gym: m?.gym ?? "",
    brand: m?.brand ?? "",
    model: m?.model ?? "",
    builtInWeight: m?.builtInWeight != null ? String(Number(m.builtInWeight)) : "",
    equipmentType: m?.equipmentType ?? "",
    pulleyRatioKind: m?.pulleyRatioKind ?? "unknown",
    notes: m?.notes ?? "",
  };
}

// Equipment detail sheet — all fields editable, used-by list, merge (history-
// moves copy kept), history-safe delete. Doubles as the Add sheet for a new
// standalone unit: POST /api/equipment (label/built-in/notes) then PATCH the
// structured fields — the exercise-scoped new-unit sheet doesn't fit here
// (no exercise context), so the same field layout is reused via these routes.
export function EquipmentSheet({
  unit,
  allUnits,
  onChanged,
  onClose,
}: {
  unit: EquipmentUnit | null; // null = add mode
  allUnits: EquipmentUnit[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const isNew = unit == null;
  const [d, setD] = useState<Draft>(toDraft(unit ?? undefined));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; existingId?: string } | null>(null);
  const [section, setSection] = useState<null | "merge" | "delete">(null);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  const structured = {
    gym: d.gym,
    brand: d.brand,
    model: d.model,
    equipmentType: d.equipmentType,
    pulleyRatioKind: d.pulleyRatioKind,
    notes: d.notes,
    builtInWeight: d.builtInWeight.trim() === "" ? null : Number(d.builtInWeight),
  };

  async function save() {
    if (!d.label.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (isNew) {
        const id = crypto.randomUUID();
        const post = await fetch("/api/equipment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, label: d.label.trim(), builtInWeight: structured.builtInWeight, notes: d.notes || null }),
        });
        if (!post.ok) {
          setErr({ message: "Couldn't create the unit." });
          return;
        }
        // Structured fields (type/pulley/gym/brand/model) land via PATCH.
        await fetch(`/api/equipment/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: d.label.trim(), ...structured }),
        });
      } else {
        const res = await fetch(`/api/equipment/${encodeURIComponent(unit!.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: d.label.trim(), ...structured }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setErr({ message: body?.message ?? "Couldn't save.", existingId: body?.existingId });
          return;
        }
      }
      await onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function merge(targetId: string) {
    if (isNew || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(unit!.id)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (res.ok) {
        await onChanged();
        onClose();
      } else {
        const body = await res.json().catch(() => null);
        setErr({ message: body?.message ?? "Merge failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (isNew || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(unit!.id)}`, { method: "DELETE" });
      if (res.ok) {
        await onChanged();
        onClose();
      } else {
        const body = await res.json().catch(() => null);
        setErr({ message: body?.message ?? "Couldn't delete." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={isNew ? "Add equipment unit" : unit!.label}
      subtitle={!isNew && unit!.loggedCount > 0 ? `${unit!.loggedCount} logged set${unit!.loggedCount === 1 ? "" : "s"} reference this unit` : undefined}
      onClose={onClose}
    >
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Label</span>
        <input className={styles.fieldInput} value={d.label} onChange={(e) => set({ label: e.target.value })} autoFocus={isNew} />
      </div>

      <div className={styles.fieldRow} style={{ marginTop: 10 }}>
        <label className={styles.fieldHalf}>
          <span className={styles.fieldLabel}>Type</span>
          <select className={styles.fieldInput} value={d.equipmentType} onChange={(e) => set({ equipmentType: e.target.value })}>
            {EQUIPMENT_UNIT_TYPES.map((t) => <option key={t} value={t}>{t === "" ? "type…" : t}</option>)}
          </select>
        </label>
        <label className={styles.fieldHalf}>
          <span className={styles.fieldLabel}>Built-in lb</span>
          <input
            type="number"
            className={styles.fieldInput}
            value={d.builtInWeight}
            onChange={(e) => set({ builtInWeight: e.target.value })}
            title="Constant added weight (bar/handles/carriage) — auto-added to logged loads"
          />
        </label>
        <label className={styles.fieldHalf}>
          <span className={styles.fieldLabel}>Pulley</span>
          <select
            className={styles.fieldInput}
            value={d.pulleyRatioKind}
            onChange={(e) => set({ pulleyRatioKind: e.target.value })}
            title="Interpretation only — never folded into logged loads (a ratio cancels out of every lane-scoped comparison)."
          >
            {PULLEY_KINDS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <div className={styles.fieldRow} style={{ marginTop: 10 }}>
        <label className={styles.fieldHalf}>
          <span className={styles.fieldLabel}>Gym / location</span>
          <input className={styles.fieldInput} value={d.gym} onChange={(e) => set({ gym: e.target.value })} />
        </label>
        <label className={styles.fieldHalf}>
          <span className={styles.fieldLabel}>Manufacturer</span>
          <input className={styles.fieldInput} value={d.brand} onChange={(e) => set({ brand: e.target.value })} />
        </label>
        <label className={styles.fieldHalf}>
          <span className={styles.fieldLabel}>Model</span>
          <input className={styles.fieldInput} value={d.model} onChange={(e) => set({ model: e.target.value })} />
        </label>
      </div>

      <div className={styles.field} style={{ marginTop: 10 }}>
        <span className={styles.fieldLabel}>Description</span>
        <textarea className={styles.fieldArea} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="serials, links, quirks…" rows={2} />
      </div>

      {err && (
        <div className={styles.warnBox} style={{ marginTop: 10 }}>
          <p className={styles.errText}>{err.message}</p>
          {err.existingId && (
            <button type="button" className={styles.quietBtn} style={{ marginTop: 8 }} onClick={() => merge(err.existingId!)} disabled={busy}>
              Merge into the existing one
            </button>
          )}
        </div>
      )}

      <div className={styles.sheetActions} style={{ marginTop: 12 }}>
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={busy || d.label.trim() === ""}>
          {isNew ? "Add unit" : "Save changes"}
        </button>
      </div>

      {!isNew && unit!.exercises.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Used by</div>
          <p className={styles.fieldNote}>{unit!.exercises.map((e) => e.name).join(", ")}</p>
        </>
      )}

      {!isNew && (
        <>
          <div className={styles.sectionLabel}>More</div>
          <div className={styles.sheetList}>
            <button type="button" className={styles.sheetRow} onClick={() => setSection(section === "merge" ? null : "merge")}>
              <span style={{ flex: 1 }}>Merge into…</span>
              <span className={styles.sheetRowMuted}>{section === "merge" ? "Close" : ""}</span>
            </button>
            {section === "merge" && (
              <div className={styles.warnBox} style={{ marginTop: 8 }}>
                <p style={{ marginBottom: 8 }}>
                  Merge <strong>{unit!.label}</strong> into another unit — its {unit!.loggedCount} logged set
                  {unit!.loggedCount === 1 ? "" : "s"} and exercise links move over (history moves, never orphans), then
                  this entry is deleted.
                </p>
                <div className={styles.sheetList}>
                  {allUnits.filter((t) => t.id !== unit!.id).map((t) => (
                    <button key={t.id} type="button" className={styles.sheetRow} onClick={() => merge(t.id)} disabled={busy}>
                      → {t.label}
                    </button>
                  ))}
                  {allUnits.length <= 1 && <p className={styles.sheetRowMuted}>No other units to merge into.</p>}
                </div>
              </div>
            )}

            <button type="button" className={styles.sheetRow} onClick={() => { setSection(section === "delete" ? null : "delete"); setErr(null); }}>
              <span style={{ flex: 1, color: "var(--danger)" }}>Delete unit</span>
              <span className={styles.sheetRowMuted}>{section === "delete" ? "Close" : ""}</span>
            </button>
            {section === "delete" && (
              <div className={styles.warnBox} style={{ marginTop: 8 }}>
                {unit!.loggedCount > 0 ? (
                  <p>
                    Blocked: <strong>{unit!.loggedCount} logged set{unit!.loggedCount === 1 ? "" : "s"}</strong> reference{" "}
                    <strong>{unit!.label}</strong>. Deleting would orphan that history — use <em>Merge into…</em> to move it
                    onto another unit first.
                  </p>
                ) : (
                  <>
                    <p>Delete <strong>{unit!.label}</strong>? This can&rsquo;t be undone.</p>
                    <div className={styles.sheetActions} style={{ marginTop: 10 }}>
                      <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={remove} disabled={busy}>
                        Delete unit
                      </button>
                      <button type="button" className={styles.quietBtn} onClick={() => setSection(null)}>Keep</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
