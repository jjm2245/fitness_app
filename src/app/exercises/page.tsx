"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { Sheet } from "@/components/session/Sheet";
import { ExerciseSearch } from "@/components/ExerciseSearch";
import { ExerciseDetailSheet, KIND_LABEL, type ManagedExercise } from "@/components/editors/ExerciseDetailSheet";
import { api } from "@/components/editors/types";

type Filter = "my" | "library" | "custom";

// Exercises (phase 3): list rows + a detail sheet. The six always-visible
// buttons collapse into the sheet; the header paragraph becomes one line.
export default function ExercisesPage() {
  const [rows, setRows] = useState<ManagedExercise[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("my");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRows(await api<ManagedExercise[]>("/api/exercises/manage"));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((e) => {
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      if (filter === "library") return e.kind === "library_name" || e.kind === "named_on_ref";
      if (filter === "custom") return e.kind === "custom";
      return true; // "my" = everything managed
    });
  }, [rows, q, filter]);

  const open = rows.find((e) => e.id === openId) ?? null;

  // Stored muscle/loadType are snake_case (rectus_abdominis, machine_selectorized)
  // — display-only humanize to spaces; the underlying values are untouched.
  const humanize = (s: string) => s.replace(/_/g, " ");
  function subline(e: ManagedExercise): string {
    return [
      e.primaryMuscle ? humanize(e.primaryMuscle) : null,
      e.loadType && e.loadType !== "unknown" ? humanize(e.loadType) : null,
      e.loggedCount > 0 ? `${e.loggedCount} logged` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>My exercises</h1>
      </div>
      <p className={styles.hintLine}>Your named + custom exercises — tap one to rename, describe, or manage.</p>

      <div className={styles.searchRow}>
        <ExerciseSearchless value={q} onChange={setQ} />
      </div>
      <div className={styles.filterRow}>
        {(["my", "library", "custom"] as Filter[]).map((f) => (
          <button key={f} type="button" className={filter === f ? styles.filterChipActive : styles.filterChip} onClick={() => setFilter(f)}>
            {f === "my" ? "My" : f === "library" ? "Library" : "Custom"}
          </button>
        ))}
      </div>

      <div className={styles.rowsCard}>
        <button type="button" className={styles.addRow} onClick={() => setAdding(true)}>
          + Add an exercise
        </button>
        {!loaded ? (
          <p className={styles.emptyNote}>Loading…</p>
        ) : shown.length === 0 ? (
          <p className={styles.emptyNote}>No matches.</p>
        ) : (
          shown.map((e) => (
            <button key={e.id} type="button" className={styles.row} onClick={() => setOpenId(e.id)}>
              <span className={styles.rowMain}>
                <span className={styles.rowName}>
                  <span className={styles.rowNameText}>{e.name}</span>
                  <span className={styles.badge}>{KIND_LABEL[e.kind]}</span>
                  {e.untagged && <span className={styles.badgeWarn}>untagged</span>}
                </span>
                {subline(e) && <span className={styles.rowSub}>{subline(e)}</span>}
              </span>
              <svg className={styles.rowChevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
                <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          ))
        )}
      </div>

      {open && <ExerciseDetailSheet ex={open} onChanged={load} onClose={() => setOpenId(null)} />}
      {adding && (
        <Sheet title="Add an exercise" subtitle="Search the library and your customs, or create a custom (you'll tag a movement pattern next)." onClose={() => setAdding(false)}>
          <div>
            <ExerciseSearch
              placeholder="Search library / curated, or create custom…"
              onPick={() => { setAdding(false); void load(); }}
            />
          </div>
        </Sheet>
      )}
    </main>
  );
}

// A plain search box that filters the loaded list (no navigation) — distinct
// from ExerciseSearch, which searches the whole graph to add.
function ExerciseSearchless({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className={styles.fieldInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search your exercises…"
      type="search"
    />
  );
}
