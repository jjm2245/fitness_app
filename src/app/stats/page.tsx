"use client";

import styles from "./stats.module.css";
import { LockedTile } from "@/components/shell/LockedTile";

// Stats — placeholder until the dashboard phases land (spec §12). Same
// locked-tile language as Home so the shell never has to be remodeled.
export default function StatsPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Stats</h1>
      <p className={styles.note}>Your dashboard arrives with recovery + nutrition.</p>
      <section className={styles.tileGrid}>
        <LockedTile
          name="Training trends"
          sub="Volume and progression"
          hue="var(--hue-training)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 13l3.5-4 3 2.5L14 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
              <path d="M8 4c0-1.5 1-2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
        <LockedTile
          name="Body"
          sub="Weight trend, photos"
          hue="var(--hue-body)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
              <path d="M3.5 14c.5-3.5 2-5 4.5-5s4 1.5 4.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
      </section>
    </main>
  );
}
