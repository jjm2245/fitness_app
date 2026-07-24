"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { EquipmentSheet, type EquipmentUnit } from "@/components/editors/EquipmentSheet";
import { api } from "@/components/editors/types";
import { lbToKg } from "@/lib/units";
import { useWeightUnit } from "@/lib/useUnit";

// Equipment (phase 3): list rows + a detail sheet. The always-visible
// Edit/Merge/Delete buttons collapse into the sheet; the header paragraph
// becomes one line. Units are surrogate-keyed (id opaque + stable), so labels
// carry no data and deletes stay history-safe.
export default function EquipmentPage() {
  // Global weight display preference — unit weights follow the same toggle as
  // every other weight surface (display-only; storage stays lb).
  const [wUnit] = useWeightUnit();
  const [rows, setRows] = useState<EquipmentUnit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRows(await api<EquipmentUnit[]>("/api/equipment"));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((m) =>
      [m.label, m.gym, m.brand, m.model, m.equipmentType].filter(Boolean).some((f) => f!.toLowerCase().includes(needle))
    );
  }, [rows, q]);

  const open = rows.find((m) => m.id === openId) ?? null;

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Equipment</h1>
      </div>
      <p className={styles.hintLine}>Your labelled units — built-in weight auto-adds to loads; deleting is history-safe.</p>

      <div className={styles.searchRow}>
        <input className={styles.fieldInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search units…" type="search" />
      </div>

      <div className={styles.rowsCard}>
        <button type="button" className={styles.addRow} onClick={() => setAdding(true)}>
          + Add a unit
        </button>
        {!loaded ? (
          <p className={styles.emptyNote}>Loading…</p>
        ) : shown.length === 0 ? (
          <p className={styles.emptyNote}>
            {rows.length === 0 ? "No equipment units yet — add one, or they appear when you log with one." : "No matches."}
          </p>
        ) : (
          shown.map((m) => (
            <button key={m.id} type="button" className={styles.row} onClick={() => setOpenId(m.id)}>
              <span className={styles.rowMain}>
                <span className={styles.rowName}>
                  <span className={styles.rowNameText}>{m.label}</span>
                  {m.equipmentType && <span className={styles.badge}>{m.equipmentType}</span>}
                  {m.builtInWeight != null && Number(m.builtInWeight) !== 0 && (
                    <span className={styles.badge}>+{wUnit === "kg" ? `${lbToKg(Number(m.builtInWeight))} kg` : `${Number(m.builtInWeight)} lb`} built-in</span>
                  )}
                  {m.pulleyRatioKind !== "unknown" && <span className={styles.badge}>pulley {m.pulleyRatioKind}</span>}
                </span>
                <span className={styles.rowSub}>
                  {[
                    [m.brand, m.model, m.gym].filter(Boolean).join(" · ") || null,
                    m.exercises.length > 0 ? `used by ${m.exercises.length}` : null,
                    m.loggedCount > 0 ? `${m.loggedCount} logged` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <svg className={styles.rowChevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
                <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          ))
        )}
      </div>

      {open && <EquipmentSheet unit={open} allUnits={rows} onChanged={load} onClose={() => setOpenId(null)} />}
      {adding && <EquipmentSheet unit={null} allUnits={rows} onChanged={load} onClose={() => setAdding(false)} />}
    </main>
  );
}
