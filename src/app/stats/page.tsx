"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./stats.module.css";
import { LockedTile } from "@/components/shell/LockedTile";

// Stats hub. Zones light up IN PLACE (the LockedTile contract): Exercises is
// live as of Stats v1, Muscles is queued ("next" — the v2 that finally gives
// core/volume.ts a consumer), the rest stay honestly locked.

interface HubMeta {
  exercisesTracked: number;
  prsThisMonth: number;
  monthLabel: string;
  lastTrained: string | null;
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function StatsPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<HubMeta | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats/exercises", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setMeta(j.meta);
      } catch {
        /* offline — the tile still opens; the index page handles its own state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Computed, never a literal — the tile reads what the data says today.
  const exercisesSub = meta
    ? `${meta.exercisesTracked} tracked · ${meta.prsThisMonth} PR${meta.prsThisMonth === 1 ? "" : "s"} in ${meta.monthLabel}` +
      (meta.lastTrained ? ` · last trained ${shortDay(meta.lastTrained)}` : "")
    : "Per-exercise history";

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Stats</h1>
      <section className={styles.tileGrid}>
        <LockedTile
          live
          onOpen={() => router.push("/stats/exercises")}
          name="Exercises"
          sub={exercisesSub}
          hue="var(--hue-training)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 13l3.5-4 3 2.5L14 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          }
        />
        <LockedTile
          tag="next"
          name="Muscles"
          sub="Weekly volume by muscle"
          hue="var(--hue-training)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 13V8m5 5V4m5 9V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          }
        />
        <LockedTile
          name="Body"
          sub="Weight and photos"
          hue="var(--hue-body)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M4 14c.5-3 1.8-4.5 4-4.5S11.5 11 12 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
        <LockedTile
          name="Recovery"
          sub="Sleep, HRV, readiness"
          hue="var(--hue-recovery)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 9c2-5 4-5 6 0s4 5 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
        <LockedTile
          name="Nutrition"
          sub="Intake vs. target"
          hue="var(--hue-nutrition)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="9" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
              <path d="M8 4V2m0 0c1 0 2 .5 2 .5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
      </section>
    </main>
  );
}
