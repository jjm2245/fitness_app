"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { Sheet } from "@/components/session/Sheet";
import { ExerciseSearch } from "@/components/ExerciseSearch";
import { ExerciseDetailSheet, type ManagedExercise } from "@/components/editors/ExerciseDetailSheet";
import { api } from "@/components/editors/types";

type Tab = "all" | "library" | "renamed" | "custom";

// How many rows we render at once. The manage payload is the full catalog
// (~880 rows) fetched once and filtered client-side; rendering is capped so the
// list stays fast on a phone — search narrows past the cap (search-first).
const RENDER_CAP = 150;

// Exercises (exercise-section v2): four tabs over the FULL catalog, quiet rows
// (no pill badges — the subline carries kind/muscle/equipment/logged; a small
// dot is the only inline marker, on personalized library rows), and the
// three-variant edit sheet. `?edit=<id>` opens an exercise's sheet directly
// (the target sheet's "Edit exercise →" link).
export default function ExercisesPage() {
  const [rows, setRows] = useState<ManagedExercise[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRows(await api<ManagedExercise[]>("/api/exercises/manage"));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Deep link: /exercises?edit=<id> opens that exercise's sheet (used by the
  // program/blocks target sheet). Read once, then strip the param so closing
  // the sheet doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const edit = params.get("edit");
    if (edit) {
      setOpenId(edit);
      params.delete("edit");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  // A row is "renamed" when it carries a library reference under a different
  // display name. Rows with no canonical reference are the Custom set (true
  // customs + the couple of curated originals with no library twin).
  const isRenamed = (e: ManagedExercise) => e.canonicalName != null && e.name !== e.canonicalName;
  const displayName = (e: ManagedExercise) => (tab === "library" ? e.canonicalName ?? e.name : e.name);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inTab = rows.filter((e) => {
      if (tab === "library") return e.canonicalName != null;
      if (tab === "renamed") return isRenamed(e);
      if (tab === "custom") return e.canonicalName == null;
      return true; // all
    });
    const matched = needle
      ? inTab.filter(
          (e) =>
            e.name.toLowerCase().includes(needle) ||
            (e.canonicalName ?? "").toLowerCase().includes(needle)
        )
      : inTab;
    // A–Z within the tab, by the name the tab displays.
    const byName = (e: ManagedExercise) => (tab === "library" ? e.canonicalName ?? e.name : e.name);
    return [...matched].sort((a, b) => byName(a).localeCompare(byName(b)));
  }, [rows, q, tab]);

  const visible = shown.slice(0, RENDER_CAP);

  const open = rows.find((e) => e.id === openId) ?? null;

  // Stored muscle/loadType are snake_case — display-only humanize.
  const humanize = (s: string) => s.replace(/_/g, " ");

  // Quiet subline: kind-word (only where the tab doesn't imply it) · primary
  // muscle · equipment · N logged. On the Library tab, a renamed row's subline
  // leads with the rename hint instead.
  function subline(e: ManagedExercise): string {
    const parts: (string | null)[] = [];
    if (tab === "library" && isRenamed(e)) parts.push(`renamed “${e.name}”`);
    if (tab === "all") {
      if (e.canonicalName == null) parts.push("custom");
      else if (isRenamed(e)) parts.push("renamed");
    }
    parts.push(e.primaryMuscle ? humanize(e.primaryMuscle) : null);
    parts.push(e.loadType && e.loadType !== "unknown" ? humanize(e.loadType) : null);
    parts.push(e.loggedCount > 0 ? `${e.loggedCount} logged` : null);
    return parts.filter(Boolean).join(" · ");
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "library", label: "Library" },
    { id: "renamed", label: "Renamed" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Exercises</h1>
      </div>
      <p className={styles.hintLine}>
        Rename anything to what you call it, create your own, and set each exercise&rsquo;s type, tag, equipment, and how it logs.
      </p>

      <div className={styles.searchRow}>
        <input
          className={styles.fieldInput}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search exercises…"
          type="search"
        />
      </div>
      <div className={styles.filterRow}>
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? styles.filterChipActive : styles.filterChip} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.rowsCard}>
        <button type="button" className={styles.addRow} onClick={() => setAdding(true)}>
          + Add an exercise
        </button>
        {!loaded ? (
          <p className={styles.emptyNote}>Loading…</p>
        ) : visible.length === 0 ? (
          <p className={styles.emptyNote}>No matches.</p>
        ) : (
          <>
            {visible.map((e) => (
              <button key={e.id} type="button" className={styles.row} onClick={() => setOpenId(e.id)}>
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>
                    <span className={styles.rowNameText}>{displayName(e)}</span>
                    {tab === "library" && isRenamed(e) && <span className={styles.renamedDot} aria-label="renamed" />}
                  </span>
                  {subline(e) && <span className={styles.rowSub}>{subline(e)}</span>}
                </span>
                <svg className={styles.rowChevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
                  <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            ))}
            {shown.length > RENDER_CAP && (
              <p className={styles.emptyNote}>
                Showing {RENDER_CAP} of {shown.length} — keep typing to narrow.
              </p>
            )}
          </>
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
