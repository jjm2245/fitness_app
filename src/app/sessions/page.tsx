"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./sessions.module.css";
import {
  createSession,
  listLocalSessionSummaries,
  attachToComposition,
  sync,
  pendingCount,
  type LocalSessionSummary,
  type AttachExercise,
} from "@/lib/sessionStore";
import { prettyDayName } from "@/lib/labels";

// The sessions list is the app's home base: this is where sessions live. A
// session is a thing you start (Start a new session), do on /log/[id], and
// finish — which returns here with the new row visible. The list merges the
// durable local store with the server's finished sessions, keyed by session id,
// so it renders fully offline (no network round-trip to see your sessions).

interface ServerSession {
  id: string;
  date: string;
  finishedAt: string | null;
  programDay: string | null;
  exerciseCount: number;
  description: string;
  synced: true;
}

interface ProgramExercise {
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  targetSets: number;
  repRange: string | null;
  rirTarget: string | null;
  params: Record<string, unknown> | null;
  source: string;
  untagged: boolean;
}
interface ProgramDay {
  id: number;
  name: string;
  exercises: ProgramExercise[];
}
interface ProgramDetail {
  id: number;
  splitType: string;
  days: ProgramDay[];
}

interface Row {
  id: string;
  date: string;
  finishedAt: string | null;
  label: string;
  exerciseCount: number;
  inProgress: boolean;
  onServer: boolean;
  local: boolean;
  pendingSync: boolean;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function whenLabel(row: Row): string {
  if (row.inProgress) return "In progress";
  if (!row.finishedAt) return row.date;
  const d = new Date(row.finishedAt);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function describe(label: string, n: number): string {
  const l = label.trim() || "Ad-hoc";
  return `${l} · ${n === 1 ? "1 exercise" : `${n} exercises`}`;
}

export default function SessionsPage() {
  const router = useRouter();
  const [local, setLocal] = useState<LocalSessionSummary[]>([]);
  const [server, setServer] = useState<ServerSession[]>([]);
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [pending, setPending] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    const summaries = await listLocalSessionSummaries();
    setLocal(summaries);
    setPending(await pendingCount());
    // Server list is best-effort: offline, we still render the local store.
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) setServer(await res.json());
    } catch {
      /* offline — keep whatever we last had */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      // Push up anything pending, then read a fresh merged view.
      await sync().catch(() => {});
      await refresh();
      try {
        const res = await fetch("/api/program");
        if (res.ok) setProgram(await res.json());
      } catch {
        /* offline — new sessions can still be started ad-hoc */
      }
    })();
    const onOnline = () => sync().then(refresh).catch(() => {});
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  // Merge local + server by session id. Local wins (freshest, may be in
  // progress); server-only sessions are appended so nothing is hidden.
  const rows: Row[] = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const s of server) {
      byId.set(s.id, {
        id: s.id,
        date: s.date,
        finishedAt: s.finishedAt,
        label: s.programDay ?? "Ad-hoc",
        exerciseCount: s.exerciseCount,
        inProgress: !s.finishedAt,
        onServer: true,
        local: false,
        pendingSync: false,
      });
    }
    for (const s of local) {
      const prev = byId.get(s.id);
      byId.set(s.id, {
        id: s.id,
        date: s.date,
        finishedAt: s.finishedAt,
        label: s.origin,
        exerciseCount: s.exerciseCount,
        inProgress: !s.finishedAt,
        onServer: prev?.onServer ?? false,
        local: true,
        pendingSync: (!!s.finishedAt && !s.finishSynced) || s.exerciseCount !== (prev?.exerciseCount ?? s.exerciseCount),
      });
    }
    const all = Array.from(byId.values());
    // In-progress first, then finished newest-first.
    return all.sort((a, b) => {
      if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
      const at = a.finishedAt ?? a.date;
      const bt = b.finishedAt ?? b.date;
      return at < bt ? 1 : at > bt ? -1 : 0;
    });
  }, [local, server]);

  const inProgress = rows.filter((r) => r.inProgress);
  const finished = rows.filter((r) => !r.inProgress);

  function open(id: string) {
    router.push(`/log/${id}`);
  }

  const toAttach = (day: ProgramDay): AttachExercise[] =>
    day.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName,
      loadType: e.loadType,
      portable: e.portable,
      conditioningOnly: e.conditioningOnly,
      provenance: e.source,
      untagged: e.untagged,
      targetSets: e.targetSets,
      repRange: e.repRange,
      rirTarget: e.rirTarget,
      params: e.params,
    }));

  async function start(day: ProgramDay | null) {
    if (starting) return;
    setStarting(true);
    try {
      const origin = day ? prettyDayName(day.name) : "Ad-hoc";
      const session = await createSession({ date: todayIso(), origin, programId: program?.id ?? null });
      if (day) await attachToComposition(session.id, toAttach(day), origin);
      router.push(`/log/${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1>Sessions</h1>
        <button className={styles.startBtn} onClick={() => setPickerOpen((o) => !o)} disabled={starting}>
          {pickerOpen ? "Close" : "Start a new session"}
        </button>
      </div>

      <div className={styles.statusBar}>
        <span>{pending > 0 ? `${pending} change(s) pending sync` : "All changes synced"}</span>
      </div>

      {pickerOpen && (
        <div className={styles.picker}>
          <p className={styles.pickerHint}>Start from a program day, or an empty ad-hoc session you build as you go.</p>
          <div className={styles.dayChoice}>
            {program?.days.map((d) => (
              <button key={d.id} className={styles.dayChoiceBtn} onClick={() => start(d)} disabled={starting}>
                {d.name} <span style={{ opacity: 0.6 }}>({d.exercises.length})</span>
              </button>
            ))}
            <button className={styles.dayChoiceBtn} onClick={() => start(null)} disabled={starting}>
              Ad-hoc session
            </button>
          </div>
        </div>
      )}

      {!loaded ? (
        <p className={styles.empty}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No sessions yet. Start one above.</p>
      ) : (
        <>
          {inProgress.length > 0 && (
            <>
              <div className={styles.sectionLabel}>In progress</div>
              <ul className={styles.list}>
                {inProgress.map((r) => (
                  <SessionRow key={r.id} row={r} onOpen={open} />
                ))}
              </ul>
            </>
          )}
          {finished.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Finished</div>
              <ul className={styles.list}>
                {finished.map((r) => (
                  <SessionRow key={r.id} row={r} onOpen={open} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className={styles.links}>
        <Link href="/program">Program</Link>
        <Link href="/blocks">Blocks</Link>
      </div>
    </main>
  );
}

function SessionRow({ row, onOpen }: { row: Row; onOpen: (id: string) => void }) {
  return (
    <li>
      <button className={styles.row} onClick={() => onOpen(row.id)}>
        <div className={styles.rowTop}>
          <span className={styles.rowTitle}>{row.label.trim() || "Ad-hoc"}</span>
          <span className={styles.rowWhen}>{whenLabel(row)}</span>
        </div>
        <div className={styles.rowSub}>
          <span>{describe(row.label, row.exerciseCount)}</span>
          {row.inProgress && <span className={`${styles.badge} ${styles.badgeProgress}`}>resume</span>}
          {row.pendingSync && <span className={`${styles.badge} ${styles.badgePending}`}>not synced</span>}
        </div>
      </button>
    </li>
  );
}
