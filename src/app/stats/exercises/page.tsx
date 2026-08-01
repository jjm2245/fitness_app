"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../stats.module.css";
import { deltaText, type Delta, type LaneMode } from "@/lib/statsShape";
import { useWeightUnit } from "@/lib/useUnit";
import { displayLb, lbToKg } from "@/lib/units";

// /stats/exercises — one row per exercise that appears in set_logs (~28).
// Reads /api/stats/exercises, never the manage payload (878 rows). Everything
// numeric arrives canonical-lb and converts at render through the display
// preference; stored values untouched.

interface IndexEntry {
  exerciseId: string;
  name: string;
  sessionCount: number;
  machineLanes: number;
  lastTrained: string;
  laneMode: LaneMode;
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  figure: { load?: number; reps?: number; date: string };
  arc: Delta;
  arcHasUnit: boolean;
  latestIsBest: boolean;
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function StatsExercisesPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
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

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Exercises</h1>
      {entries == null ? (
        <p className={styles.note}>Loading…</p>
      ) : entries.length === 0 ? (
        <p className={styles.note}>Nothing logged yet — history appears here after your first session.</p>
      ) : (
        <ul className={styles.exList}>
          {entries.map((e) => (
            <li key={e.exerciseId}>
              <button
                type="button"
                className={styles.exRow}
                onClick={() => router.push(`/stats/exercises/${encodeURIComponent(e.exerciseId)}`)}
              >
                <span className={styles.exMain}>
                  <span className={styles.exNameLine}>
                    <span className={styles.exName}>{e.name}</span>
                    {/* The machine, when it says something the name doesn't:
                        one named unit → its label; several → a count hint. */}
                    {e.machineLanes >= 2 ? (
                      <span className={styles.mTag}>{e.machineLanes} machines</span>
                    ) : e.machineTagKind === "unit" ? (
                      <span className={styles.mTag}>{e.machineTag}</span>
                    ) : e.machineTagKind === "unspecified" ? (
                      <span className={`${styles.mTag} ${styles.mTagUnspec}`}>unspecified</span>
                    ) : (
                      <span className={styles.mTag}>no machine</span>
                    )}
                  </span>
                  {/* The arc: net change since this machine's history began.
                      Bright only when it is actually progress (states 1–2). */}
                  <span className={e.arc.tier === "bright" ? styles.tierBright : styles.tierQuiet}>
                    {deltaText(e.arc, w, wUnit, e.arcHasUnit)}
                  </span>
                </span>
                <span className={styles.exFigure}>
                  {e.laneMode === "loaded" ? (
                    <span className={styles.figMono}>
                      {w(e.figure.load!)} {wUnit}
                    </span>
                  ) : (
                    // Reps lanes say `last`, never `best` — and never chip.
                    <span>
                      <span className={styles.figLabel}>last </span>
                      <span className={styles.figMono}>{e.figure.reps} reps</span>
                    </span>
                  )}
                  <span className={styles.figDate}>{shortDay(e.figure.date)}</span>
                  {e.latestIsBest && e.laneMode === "loaded" && (
                    <span className={styles.prChip} title="Latest session set this machine's best">
                      <span aria-hidden="true">★</span> PR
                    </span>
                  )}
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
