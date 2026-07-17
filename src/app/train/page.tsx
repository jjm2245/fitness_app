"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./train.module.css";
import { ListCard, ListRow } from "@/components/shell/ListRow";
import { createSession, listLocalSessionSummaries } from "@/lib/sessionStore";

// Train — the training zone's hub. A stable start card (no predictive "Up
// next" — same call as Home, polish round 2), then navigation rows into the
// existing pages with live counts. Counts load without layout shift: each
// row keeps a skeleton in its count slot until its own source resolves, the
// sources are fetched in parallel, and the local store (fast IndexedDB)
// fills the sessions count ahead of the network.

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Counts {
  sessions: number | null;
  program: string | null;
  blocks: number | null;
  exercisesTagged: number | null;
  equipment: number | null;
}

export default function TrainPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>({
    sessions: null,
    program: null,
    blocks: null,
    exercisesTagged: null,
    equipment: null,
  });
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const patch = (p: Partial<Counts>) => setCounts((prev) => ({ ...prev, ...p }));

    // Local store first — it answers in milliseconds, so the sessions count
    // renders ahead of any network response. The server list then unions in
    // sessions this device doesn't hold (rare; the number only ever grows).
    const localIds = new Set<string>();
    const localDone = listLocalSessionSummaries()
      .then((local) => {
        for (const s of local) if (s.finishedAt) localIds.add(s.id);
        patch({ sessions: localIds.size });
      })
      .catch(() => {});

    // Server sources in parallel; each fills its own row as it lands.
    await Promise.all([
      (async () => {
        try {
          const res = await fetch("/api/sessions");
          if (!res.ok) return;
          const rows: Array<{ id: string; finishedAt: string | null }> = await res.json();
          await localDone; // union with the local ids, never replace them
          const ids = new Set(localIds);
          for (const r of rows) if (r.finishedAt) ids.add(r.id);
          patch({ sessions: ids.size });
        } catch { /* offline — local count stands */ }
      })(),
      (async () => {
        try {
          const res = await fetch("/api/programs");
          if (!res.ok) return;
          const rows: Array<{ splitType: string; active: boolean }> = await res.json();
          patch({ program: rows.find((p) => p.active)?.splitType ?? null });
        } catch { /* offline */ }
      })(),
      (async () => {
        try {
          const res = await fetch("/api/blocks");
          if (res.ok) patch({ blocks: ((await res.json()) as unknown[]).length });
        } catch { /* offline */ }
      })(),
      (async () => {
        try {
          const res = await fetch("/api/exercises/manage");
          if (res.ok)
            patch({ exercisesTagged: ((await res.json()) as Array<{ untagged: boolean }>).filter((e) => !e.untagged).length });
        } catch { /* offline */ }
      })(),
      (async () => {
        try {
          const res = await fetch("/api/equipment");
          if (res.ok) patch({ equipment: ((await res.json()) as unknown[]).length });
        } catch { /* offline */ }
      })(),
    ]);
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

  const n = (v: number | null, unit: string) => (v == null ? null : `${v} ${unit}${v === 1 ? "" : "s"}`);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Train</h1>

      <section className={styles.startCard}>
        <span className={styles.upNext}>Ready when you are</span>
        <button type="button" className={styles.startBtn} onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start session"}
        </button>
      </section>

      <ListCard>
        <ListRow
          href="/sessions"
          name="History"
          count={n(counts.sessions, "session")}
          pending={counts.sessions == null}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M8 4.5V8l2.4 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          }
        />
        <ListRow
          href="/program"
          name="Programs"
          count={counts.program}
          pending={counts.program == null}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          }
        />
        <ListRow
          href="/blocks"
          name="Blocks"
          count={n(counts.blocks, "block")}
          pending={counts.blocks == null}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
            </svg>
          }
        />
        <ListRow
          href="/exercises"
          name="Exercises"
          count={counts.exercisesTagged == null ? null : `${counts.exercisesTagged} tagged`}
          pending={counts.exercisesTagged == null}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="5.5" width="2.5" height="5" rx="1" fill="currentColor" />
              <rect x="12" y="5.5" width="2.5" height="5" rx="1" fill="currentColor" />
              <rect x="4" y="7.25" width="8" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          }
        />
        <ListRow
          href="/equipment"
          name="Equipment"
          count={n(counts.equipment, "unit")}
          pending={counts.equipment == null}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2v3M8 11v3M2 8h3M11 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          }
        />
      </ListCard>
    </main>
  );
}
