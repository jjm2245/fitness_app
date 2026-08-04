"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./stats.module.css";
import { LockedTile } from "@/components/shell/LockedTile";
import { useWeightUnit } from "@/lib/useUnit";
import { displayLb, lbToKg } from "@/lib/units";

// Stats hub — hero zone (Exercises) + a "Coming zones" rail of demoted cards.
// The hero's event line and sparkline are computed from real data (markPrs +
// working-set counts server-side); the zero states are computed too, never
// literals.

interface HubMeta {
  exercisesTracked: number;
  lastTrained: string | null;
  lastPr: { name: string; load: number; date: string } | null;
  spark: Array<{ workoutLogId: number; date: string; workingSets: number }>;
  latestMintedPr: boolean;
}

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

/** Working sets per session, last 8 — decorative in role, real in data.
 *  Terminal point --accent-2 iff the latest session minted a PR. */
function Spark({ spark, terminalPr }: { spark: HubMeta["spark"]; terminalPr: boolean }) {
  if (spark.length < 2) return null;
  const W = 120;
  const H = 30;
  const values = spark.map((s) => s.workingSets);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const x = (i: number) => 4 + (i * (W - 8)) / (spark.length - 1);
  const y = (v: number) => 4 + (H - 8) * (1 - (v - min) / span);
  const last = spark.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.heroSpark} aria-hidden="true">
      <polyline fill="none" className={styles.heroSparkLine} points={spark.map((s, i) => `${x(i)},${y(s.workingSets)}`).join(" ")} />
      <circle cx={x(last)} cy={y(spark[last].workingSets)} r={2.8} className={terminalPr ? styles.heroSparkDotPr : styles.heroSparkDot} />
    </svg>
  );
}

export default function StatsPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<HubMeta | null>(null);
  const [wUnit] = useWeightUnit();
  const w = (lb: number) => (wUnit === "kg" ? lbToKg(lb) : displayLb(lb));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats/exercises", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setMeta(j.meta);
      } catch {
        /* offline — the hero still opens the index */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const eventLine = meta
    ? meta.lastPr
      ? `Last PR · ${meta.lastPr.name} ${w(meta.lastPr.load)} ${wUnit} · ${daysAgo(meta.lastPr.date)}`
      : "no PRs yet"
    : "";

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Stats</h1>

      {/* Hero — the one live zone gets the screen's weight. */}
      <button type="button" className={styles.hero} onClick={() => router.push("/stats/exercises")}>
        <span className={styles.heroTop}>
          <span className={styles.heroName}>Exercises</span>
          <span className={styles.heroChev} aria-hidden="true">›</span>
        </span>
        <span className={styles.heroEvent}>{eventLine}</span>
        {meta && <Spark spark={meta.spark} terminalPr={meta.latestMintedPr} />}
      </button>

      <p className={styles.railLabel}>Coming zones</p>
      <section className={styles.tileGrid}>
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
              <path d="M8 4V2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
      </section>
    </main>
  );
}
