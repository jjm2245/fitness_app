"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../stats.module.css";
import { useWeightUnit } from "@/lib/useUnit";
import { displayLb, lbToKg } from "@/lib/units";
import type { Trend } from "@/lib/trendVerdict";

// /stats/exercises — header copies Equipment's anatomy (search + sort), rows
// carry the verdict engine's word, PR recency and session count. The accent
// left edge is the ONLY colour on a row (positive verdicts); the right column
// is a small-caps BEST/LAST tag over a mono value. No dates, no net-change
// deltas, no chips.

interface IndexEntry {
  exerciseId: string;
  name: string;
  sessionCount: number;
  machineLanes: number;
  lastTrained: string;
  laneMode: "loaded" | "reps";
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  figure: { load?: number; reps?: number };
  trend: Trend;
  prDate: string | null;
}

type SortId = "recent" | "az" | "za" | "sessions";
const SORTS: { id: SortId; label: string }[] = [
  { id: "recent", label: "Recently trained" },
  { id: "az", label: "A–Z" },
  { id: "za", label: "Z–A" },
  { id: "sessions", label: "Most sessions" },
];
const SORT_KEY = "fitness-app:stats-index-sort";

function daysAgo(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, (m ?? 1) - 1, d ?? 1);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function StatsExercisesPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortId>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  useEffect(() => {
    const v = window.localStorage.getItem(SORT_KEY);
    if (v === "az" || v === "za" || v === "sessions" || v === "recent") setSort(v);
  }, []);
  function pickSort(v: SortId) {
    setSort(v);
    setSortOpen(false);
    try {
      window.localStorage.setItem(SORT_KEY, v);
    } catch {
      /* private mode */
    }
  }

  const [wUnit] = useWeightUnit();
  const w = (lb: number) => (wUnit === "kg" ? lbToKg(lb) : displayLb(lb));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/stats/exercises", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      if (!cancelled) setEntries(j.exercises);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    if (!entries) return null;
    let list = entries;
    const needle = search.trim().toLowerCase();
    if (needle) list = list.filter((e) => e.name.toLowerCase().includes(needle));
    // Display-only sorts — the payload arrives recent-first.
    return [...list].sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name);
      if (sort === "za") return b.name.localeCompare(a.name);
      if (sort === "sessions")
        return b.sessionCount - a.sessionCount || a.name.localeCompare(b.name);
      return a.lastTrained === b.lastTrained
        ? a.name.localeCompare(b.name)
        : b.lastTrained.localeCompare(a.lastTrained);
    });
  }, [entries, search, sort]);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Exercises</h1>
      <div className={styles.idxHead}>
        <input
          type="search"
          className={styles.idxSearch}
          placeholder="Search exercises…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={styles.sortWrap}>
          <button type="button" className={styles.sortBtn} onClick={() => setSortOpen((o) => !o)}>
            Sort: {SORTS.find((s) => s.id === sort)!.label}
          </button>
          {sortOpen && (
            <div className={styles.sortMenu}>
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === sort ? styles.sortOptOn : styles.sortOpt}
                  onClick={() => pickSort(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {shown == null ? (
        <p className={styles.note}>Loading…</p>
      ) : shown.length === 0 ? (
        <p className={styles.note}>
          {search ? "No exercises match." : "Nothing logged yet — history appears here after your first session."}
        </p>
      ) : (
        <ul className={styles.exList}>
          {shown.map((e) => (
            <li key={e.exerciseId}>
              <button
                type="button"
                className={`${styles.exRow} ${e.trend.tier === "positive" ? styles.exRowUp : ""}`}
                onClick={() => router.push(`/stats/exercises/${encodeURIComponent(e.exerciseId)}`)}
              >
                <span className={styles.exMain}>
                  <span className={styles.exNameLine}>
                    <span className={styles.exName}>{e.name}</span>
                    <span className={`${styles.mTag} ${e.machineTagKind === "unspecified" ? styles.mTagUnspec : ""}`}>
                      ·{" "}
                      {e.machineLanes >= 2
                        ? `${e.machineLanes} machines`
                        : e.machineTagKind === "unit"
                        ? e.machineTag
                        : e.machineTagKind === "unspecified"
                        ? "unspecified"
                        : "no machine"}
                    </span>
                  </span>
                  {/* The engine's word, verbatim; PR recency; session count. */}
                  <span className={styles.idxMeta}>
                    <span
                      className={
                        e.trend.tier === "positive"
                          ? styles.trendUp
                          : e.trend.tier === "negative"
                          ? styles.trendDown
                          : styles.trendFlat
                      }
                    >
                      {e.trend.tier === "positive" ? "▲ " : e.trend.tier === "negative" ? "▼ " : "— "}
                      {e.trend.word}
                    </span>
                    {e.laneMode === "loaded" && (
                      <span className={styles.idxMetaBit}>
                        {" · "}
                        {e.prDate ? `PR ${daysAgo(e.prDate)}` : "no PR yet"}
                      </span>
                    )}
                    <span className={styles.idxMetaBit}>
                      {" · "}
                      {e.sessionCount} {e.sessionCount === 1 ? "session" : "sessions"}
                    </span>
                  </span>
                </span>
                <span className={styles.exFigure}>
                  <span className={styles.figTag}>{e.laneMode === "loaded" ? "BEST" : "LAST"}</span>
                  <span className={styles.figMono}>
                    {e.laneMode === "loaded" ? `${w(e.figure.load!)} ${wUnit}` : `${e.figure.reps} reps`}
                  </span>
                </span>
                <span className={styles.exChev} aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
