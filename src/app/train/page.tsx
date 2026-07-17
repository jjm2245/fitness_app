"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./train.module.css";
import { ListCard, ListRow } from "@/components/shell/ListRow";
import { createSession, listLocalSessionSummaries } from "@/lib/sessionStore";

// Train — the training zone's hub. A compact start card, then navigation rows
// into the existing pages (History/Programs/Blocks/Exercises/Equipment) with
// live counts. Pure shell: every destination is a page that already exists.

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
  upNext: string | null;
}

export default function TrainPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>({
    sessions: null,
    program: null,
    blocks: null,
    exercisesTagged: null,
    equipment: null,
    upNext: null,
  });
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    // Sessions count merges local (offline-complete) with the server list.
    const local = await listLocalSessionSummaries().catch(() => []);
    const ids = new Set(local.filter((s) => s.finishedAt).map((s) => s.id));
    let lastLabel = "";
    let dayNames: string[] = [];
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const rows: Array<{ id: string; finishedAt: string | null; programDay: string | null }> = await res.json();
        for (const r of rows) if (r.finishedAt) ids.add(r.id);
        lastLabel = rows.find((r) => r.finishedAt)?.programDay ?? "";
      }
    } catch { /* offline */ }
    const localLast = local.find((s) => s.finishedAt);
    if (localLast) lastLabel = localLast.origin || lastLabel;

    let program: string | null = null;
    try {
      const res = await fetch("/api/programs");
      if (res.ok) {
        const rows: Array<{ splitType: string; active: boolean }> = await res.json();
        program = rows.find((p) => p.active)?.splitType ?? null;
      }
    } catch { /* offline */ }
    try {
      const res = await fetch("/api/program");
      if (res.ok) dayNames = ((await res.json()).days ?? []).map((d: { name: string }) => d.name);
    } catch { /* offline */ }

    let blocks: number | null = null;
    try {
      const res = await fetch("/api/blocks");
      if (res.ok) blocks = ((await res.json()) as unknown[]).length;
    } catch { /* offline */ }

    let exercisesTagged: number | null = null;
    try {
      const res = await fetch("/api/exercises/manage");
      if (res.ok) exercisesTagged = ((await res.json()) as Array<{ untagged: boolean }>).filter((e) => !e.untagged).length;
    } catch { /* offline */ }

    let equipment: number | null = null;
    try {
      const res = await fetch("/api/equipment");
      if (res.ok) equipment = ((await res.json()) as unknown[]).length;
    } catch { /* offline */ }

    let upNext: string | null = null;
    if (dayNames.length) {
      const idx = dayNames.findIndex((n) => (lastLabel ?? "").includes(n));
      upNext = dayNames[(idx + 1) % dayNames.length] ?? dayNames[0];
    }

    setCounts({ sessions: ids.size, program, blocks, exercisesTagged, equipment, upNext });
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
        <span className={styles.upNext}>
          {counts.upNext ? (
            <>
              Up next · <strong>{counts.upNext}</strong>
            </>
          ) : (
            "Ready when you are"
          )}
        </span>
        <button type="button" className={styles.startBtn} onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start session"}
        </button>
      </section>

      <ListCard>
        <ListRow
          href="/sessions"
          name="History"
          count={n(counts.sessions, "session")}
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
