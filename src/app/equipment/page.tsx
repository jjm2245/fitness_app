"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { EquipmentSheet, type EquipmentUnit } from "@/components/editors/EquipmentSheet";
import { api } from "@/components/editors/types";
import { lbToKg } from "@/lib/units";
import { useWeightUnit } from "@/lib/useUnit";

type SortId = "az" | "za" | "logged" | "recent";
const SORTS: { id: SortId; label: string }[] = [
  { id: "az", label: "A–Z" },
  { id: "za", label: "Z–A" },
  { id: "logged", label: "Most logged" },
  { id: "recent", label: "Recently used" },
];

// Equipment: the same header grammar as the exercises page — search + add,
// a type dropdown, a "Used" switch, and display-only sorts. ~20 rows, so no
// pagination. Units are surrogate-keyed (id opaque + stable), so labels carry
// no data and deletes stay history-safe.
export default function EquipmentPage() {
  // Global weight display preference — unit weights follow the same toggle as
  // every other weight surface (display-only; storage stays lb).
  const [wUnit] = useWeightUnit();
  const [rows, setRows] = useState<EquipmentUnit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [usedOnly, setUsedOnly] = useState(false);
  const [sort, setSort] = useState<SortId>("az");
  const [typeOpen, setTypeOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRows(await api<EquipmentUnit[]>("/api/equipment"));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Types present in the data (plus counts) — no invented vocabulary.
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.equipmentType ?? "", (m.get(r.equipmentType ?? "") ?? 0) + 1);
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (needle) {
      list = list.filter((m) =>
        [m.label, m.gym, m.brand, m.model, m.equipmentType].filter(Boolean).some((f) => f!.toLowerCase().includes(needle))
      );
    }
    if (typeFilter) list = list.filter((m) => (m.equipmentType ?? "") === typeFilter);
    if (usedOnly) list = list.filter((m) => m.loggedCount > 0);
    // Sorts are display-only — they never write an order.
    const byLabel = (a: EquipmentUnit, b: EquipmentUnit) => a.label.localeCompare(b.label);
    return [...list].sort((a, b) => {
      if (sort === "az") return byLabel(a, b);
      if (sort === "za") return byLabel(b, a);
      if (sort === "logged") return b.loggedCount - a.loggedCount || byLabel(a, b);
      // recent: most recent session date first; never-used sink to the bottom
      const av = a.lastUsed ?? "", bv = b.lastUsed ?? "";
      if (av === bv) return byLabel(a, b);
      if (!av) return 1;
      if (!bv) return -1;
      return bv.localeCompare(av);
    });
  }, [rows, q, typeFilter, usedOnly, sort]);

  const open = rows.find((m) => m.id === openId) ?? null;
  const typeLabel = typeFilter === "" ? "All types" : typeFilter;

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Equipment</h1>
      </div>
      <p className={styles.hintLine}>
        The machines you train on — each keeps its own history, so your numbers compare against the same station.
      </p>

      <div className={styles.searchRow}>
        <input className={styles.fieldInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search units…" type="search" />
        <button type="button" className={styles.searchAddBtn} onClick={() => setAdding(true)} aria-label="Add a unit" title="Add a unit">
          ＋
        </button>
      </div>

      <div className={styles.viewRow}>
        <div className={styles.viewGroup}>
          <div className={styles.viewDropWrap}>
            <button type="button" className={styles.viewDropBtn} onClick={() => setTypeOpen((v) => !v)} aria-expanded={typeOpen}>
              <span className={styles.viewDropLabel}>{typeLabel}</span>
              <svg className={styles.viewDropChevron} width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
            {typeOpen && (
              <>
                <div className={styles.viewMenuScrim} onClick={() => setTypeOpen(false)} />
                <div className={styles.viewMenu} role="menu">
                  <button type="button" role="menuitem" className={typeFilter === "" ? styles.viewMenuItemActive : styles.viewMenuItem} onClick={() => { setTypeFilter(""); setTypeOpen(false); }}>
                    <span>All types</span>
                    <span className={styles.viewMenuCount}>{rows.length}</span>
                  </button>
                  {[...typeCounts.entries()].sort((a, b) => (a[0] || "~").localeCompare(b[0] || "~")).map(([t, n]) => (
                    <button
                      key={t || "(none)"}
                      type="button"
                      role="menuitem"
                      className={typeFilter === t ? styles.viewMenuItemActive : styles.viewMenuItem}
                      onClick={() => { setTypeFilter(t); setTypeOpen(false); }}
                    >
                      <span>{t === "" ? "no type set" : t}</span>
                      <span className={styles.viewMenuCount}>{n}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={styles.viewDropWrap}>
            <button
              type="button"
              className={`${styles.viewDropBtn} ${styles.viewSortBtn}`}
              onClick={() => setSortOpen((v) => !v)}
              aria-expanded={sortOpen}
              // The label is the accessible name at every width — below the
              // breakpoint the button is icon-only, so the current sort has to
              // survive somewhere readable.
              aria-label={`Sort: ${SORTS.find((s) => s.id === sort)!.label}`}
              title={`Sort: ${SORTS.find((s) => s.id === sort)!.label}`}
            >
              <svg className={styles.viewSortIcon} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 3.5h10M3.5 7h7M5.5 10.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className={styles.viewDropLabel}>{SORTS.find((s) => s.id === sort)!.label}</span>
              <svg className={styles.viewDropChevron} width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
            {sortOpen && (
              <>
                <div className={styles.viewMenuScrim} onClick={() => setSortOpen(false)} />
                <div className={styles.viewMenu} role="menu">
                  {SORTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitem"
                      className={sort === s.id ? styles.viewMenuItemActive : styles.viewMenuItem}
                      onClick={() => { setSort(s.id); setSortOpen(false); }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
        </div>
        </div>

        <button type="button" className={styles.switchRow} role="switch" aria-checked={usedOnly} onClick={() => setUsedOnly((v) => !v)}>
          <span className={styles.switchLabel}>Used</span>
          <span className={`${styles.switchTrack} ${usedOnly ? styles.switchTrackOn : ""}`}>
            <span className={styles.switchKnob} />
          </span>
        </button>
      </div>

      <div className={styles.rowsCard}>
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
