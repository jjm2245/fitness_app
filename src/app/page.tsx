"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./home.module.css";
import { LockedTile } from "@/components/shell/LockedTile";
import { createSession, listLocalSessionSummaries } from "@/lib/sessionStore";

// Home — the aggregator (spec §12), built shell-first. Training is the only
// live zone; Recovery / Nutrition / Body / Coach render as honestly-locked
// tiles so later phases light them up in place instead of remodeling. This
// replaces the old dev index entirely. Data is read from existing endpoints +
// the local store — no new APIs.

interface ServerSessionRow {
  id: string;
  date: string;
  finishedAt: string | null;
  firstFinishedAt: string | null;
  programDay: string | null;
  exerciseCount: number;
}

interface TrainingSnapshot {
  weekDone: number;
  last: string | null; // last finished session's name — no counts (kept honest & quiet)
}

// LOCAL calendar date (never UTC — evening sessions must not file to tomorrow).
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday of the current local week, as YYYY-MM-DD.
function weekStartIso() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

export default function HomePage() {
  const router = useRouter();
  const [snap, setSnap] = useState<TrainingSnapshot | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    // Local store first (offline-complete), server list best-effort.
    const local = await listLocalSessionSummaries().catch(() => []);
    let server: ServerSessionRow[] = [];
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) server = await res.json();
    } catch { /* offline — local is enough */ }

    // Merge finished sessions by id — local wins (fresher), server fills gaps.
    const byId = new Map<string, { date: string; label: string; finishedAt: string | null }>();
    for (const s of server) {
      if (!s.finishedAt) continue;
      byId.set(s.id, {
        date: s.date,
        label: s.programDay?.trim() || "Ad-hoc",
        finishedAt: s.firstFinishedAt ?? s.finishedAt,
      });
    }
    for (const s of local) {
      if (!s.finishedAt) continue;
      byId.set(s.id, {
        date: s.date,
        label: s.origin.trim() || "Ad-hoc",
        finishedAt: s.firstFinishedAt ?? s.finishedAt,
      });
    }
    const finished = [...byId.values()].sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.finishedAt ?? "") < (b.finishedAt ?? "") ? 1 : -1
    );

    const weekStart = weekStartIso();
    const weekDone = finished.filter((s) => s.date >= weekStart).length;
    setSnap({ weekDone, last: finished[0]?.label ?? null });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    if (starting) return;
    setStarting(true);
    try {
      const session = await createSession({ date: todayIso(), origin: "New session", programId: null });
      router.push(`/log/${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  const dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <main className={styles.page}>
      <header className={styles.greeting}>
        <div className={styles.greetLine}>{greeting()}</div>
        <div className={styles.dateLine}>{dateLine}</div>
      </header>

      <section className={styles.trainingCard}>
        {/* The header IS the doorway: Home's training card and the Train tab
            are one thing, not two features — tapping it goes there. */}
        <button type="button" className={styles.trainingHead} onClick={() => router.push("/train")}>
          <span className={styles.zoneLabel}>
            Training
            <svg width="8" height="13" viewBox="0 0 7 12" fill="none" aria-hidden="true">
              <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </span>
          <span className={styles.weekProgress}>
            {snap ? (
              <>
                <strong>{snap.weekDone}</strong> this week
              </>
            ) : (
              "…"
            )}
          </span>
        </button>

        <div className={styles.startWrap}>
          <div className={styles.startGlow} />
          <button type="button" className={styles.startBtn} onClick={start} disabled={starting}>
            {starting ? "Starting…" : "Start session"}
          </button>
        </div>

        {snap?.last && (
          <div className={styles.trainingMeta}>
            <span>
              Last · <strong>{snap.last}</strong>
            </span>
          </div>
        )}
      </section>

      <section className={styles.tileGrid}>
        <LockedTile
          name="Recovery"
          sub="Connect Oura"
          hue="var(--hue-recovery)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 9c2-5 4-5 6 0s4 5 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
        <LockedTile
          name="Nutrition"
          sub="Coming soon"
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
          sub="Weight and photos"
          hue="var(--hue-body)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
              <path d="M3.5 14c.5-3.5 2-5 4.5-5s4 1.5 4.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
        <LockedTile
          name="Coach"
          sub="After 2 wks of logs"
          hue="var(--hue-coach)"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2l1.4 3.3L13 6l-3 2.4.9 3.6L8 10l-2.9 2 .9-3.6L3 6l3.6-.7L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
            </svg>
          }
        />
      </section>
    </main>
  );
}
