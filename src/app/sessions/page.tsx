"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./sessions.module.css";
import {
  createSession,
  listLocalSessionSummaries,
  deleteSession,
  reconcileFinishedFromServer,
  reconcileOccurrenceList,
  rehydrateLocalFromServer,
  sync,
  pendingCount,
  type LocalSessionSummary,
} from "@/lib/sessionStore";

// The sessions list is the app's home base: this is where sessions live. A
// session is a thing you start (Start a new session), do on /log/[id], and
// finish — which returns here with the new row visible. The list merges the
// durable local store with the server's finished sessions, keyed by session id,
// so it renders fully offline (no network round-trip to see your sessions).

interface ServerSession {
  id: string;
  date: string;
  finishedAt: string | null;
  firstFinishedAt: string | null;
  programDay: string | null;
  exerciseCount: number;
  description: string;
  synced: true;
}

interface Row {
  id: string;
  date: string;
  finishedAt: string | null;
  // Stable first-finish instant — display/sort anchor (never re-stamped).
  firstFinishedAt: string | null;
  label: string;
  exerciseCount: number;
  inProgress: boolean;
  onServer: boolean;
  local: boolean;
  pendingSync: boolean;
  // Why it's pending — surfaced in the badge so "not synced" is never a mystery
  // (esp. on a phone, where we can't open the store). null when fully synced.
  pendingReason: string | null;
  // This device is the stale side (server has sets it lacks) — offer "pull from
  // server" instead of "Reconcile" (which would be a no-op here).
  conflict: boolean;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// The displayed date comes from the STABLE anchors: the session's `date`
// (creation day, never rewritten) + the time-of-day of the FIRST finish.
// `finishedAt` re-stamps on every re-finish and must never move a session in
// the list — editing yesterday's session had been jumping it to "today".
function whenLabel(row: Row): string {
  if (row.inProgress) return "In progress";
  // Parse the ISO date as LOCAL calendar parts (new Date("YYYY-MM-DD") is UTC
  // midnight, which renders as the previous day in negative-offset timezones).
  const [y, m, d] = row.date.split("-").map(Number);
  const dateLabel = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!row.firstFinishedAt) return dateLabel;
  const t = new Date(row.firstFinishedAt);
  return `${dateLabel} · ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function describe(label: string, n: number): string {
  const l = label.trim() || "Ad-hoc";
  return `${l} · ${n === 1 ? "1 exercise" : `${n} exercises`}`;
}

export default function SessionsPage() {
  const router = useRouter();
  const [local, setLocal] = useState<LocalSessionSummary[]>([]);
  const [server, setServer] = useState<ServerSession[]>([]);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState<"auth" | "network" | "server" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const drain = useCallback(async () => {
    const r = await sync().catch(() => null);
    if (r) setSyncError(r.authError ? "auth" : r.networkError ? "network" : r.serverError ? "server" : null);
  }, []);

  const refresh = useCallback(async () => {
    // Server list is best-effort: offline, we still render the local store.
    let serverSessions: ServerSession[] | null = null;
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) serverSessions = await res.json();
    } catch {
      /* offline — keep whatever we last had */
    }
    // Trust the server on finish: if it reports a session finished, a stale local
    // finishSynced=false is corrected here (deterministic, not "self-heals later")
    // so a server-confirmed session can't show a false "not synced".
    if (serverSessions) {
      const finishedIds = serverSessions.filter((s) => s.finishedAt).map((s) => s.id);
      if (finishedIds.length) await reconcileFinishedFromServer(finishedIds);
      setServer(serverSessions);
    }
    // Read local AFTER reconciling so the summaries reflect the corrected flags.
    setLocal(await listLocalSessionSummaries());
    setPending(await pendingCount());
    setLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      // Push up anything pending, then read a fresh merged view.
      await drain();
      await refresh();
    })();
    const onOnline = () => drain().then(refresh).catch(() => {});
    const onFocus = () => { if (document.visibilityState === "visible") drain().then(refresh).catch(() => {}); };
    window.addEventListener("online", onOnline);
    window.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, drain]);

  // Merge local + server by session id. Local wins (freshest, may be in
  // progress); server-only sessions are appended so nothing is hidden.
  const rows: Row[] = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const s of server) {
      byId.set(s.id, {
        id: s.id,
        date: s.date,
        finishedAt: s.finishedAt,
        firstFinishedAt: s.firstFinishedAt ?? null,
        label: s.programDay ?? "Ad-hoc",
        exerciseCount: s.exerciseCount,
        inProgress: !s.finishedAt,
        onServer: true,
        local: false,
        pendingSync: false,
        pendingReason: null,
        conflict: false,
      });
    }
    for (const s of local) {
      const prev = byId.get(s.id);
      // Finish arm: the local finish flag hasn't flipped AND the server doesn't
      // already show this session finished (refresh reconciles that case, so a
      // server-confirmed finish never trips this). List arm: the local occurrence
      // count disagrees with the server's — a genuinely pending list change.
      const finishPending = !!s.finishedAt && !s.finishSynced && !prev?.finishedAt;
      const serverCount = prev?.exerciseCount ?? s.exerciseCount;
      const listPending = s.exerciseCount !== serverCount;
      // Conflict wins: the server proved it holds logged sets this device is
      // missing, so re-POSTing local is a dead end — the heal is to pull down.
      const conflict = !!s.occurrenceConflict;
      const reason = conflict
        ? "this device is behind"
        : finishPending
        ? "finish"
        : listPending
        ? `list (local ${s.exerciseCount}${prev ? ` / server ${serverCount}` : ""})`
        : null;
      byId.set(s.id, {
        id: s.id,
        date: s.date,
        finishedAt: s.finishedAt,
        firstFinishedAt: s.firstFinishedAt ?? prev?.firstFinishedAt ?? null,
        label: s.origin,
        exerciseCount: s.exerciseCount,
        inProgress: !s.finishedAt,
        onServer: prev?.onServer ?? false,
        local: true,
        pendingSync: reason !== null,
        pendingReason: reason,
        conflict,
      });
    }
    const all = Array.from(byId.values());
    // In-progress first, then finished newest-first — by the STABLE anchors
    // (session date, then first-finish time), never the re-stampable finishedAt.
    return all.sort((a, b) => {
      if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const at = a.firstFinishedAt ?? "";
      const bt = b.firstFinishedAt ?? "";
      return at < bt ? 1 : at > bt ? -1 : 0;
    });
  }, [local, server]);

  const inProgress = rows.filter((r) => r.inProgress);
  const finished = rows.filter((r) => !r.inProgress);

  function open(id: string) {
    router.push(`/log/${id}`);
  }

  const [reconciling, setReconciling] = useState<string | null>(null);
  async function reconcile(id: string) {
    if (reconciling) return;
    setReconciling(id);
    try {
      await reconcileOccurrenceList(id); // re-POST local list; server prunes (history-safe)
      await refresh();
    } finally {
      setReconciling(null);
    }
  }

  // The opposite heal: this device is behind, so pull the server's copy down.
  async function pullFromServer(id: string) {
    if (reconciling) return;
    setReconciling(id);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      if (res.ok) {
        await rehydrateLocalFromServer(await res.json());
        await refresh();
      }
    } finally {
      setReconciling(null);
    }
  }

  async function doDelete() {
    if (!confirm || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(confirm.id);
      setConfirm(null);
      await refresh();
      await drain(); // server delete drains when online; queued offline
      await refresh();
    } finally {
      setDeleting(false);
    }
  }

  // Start an empty session and go straight to logging — you build the ordered
  // list incrementally there (the program is a quick-add palette, not a
  // pre-loaded day). The session name aggregates from what you add.
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

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1>Sessions</h1>
        <button className={styles.startBtn} onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start a new session"}
        </button>
      </div>

      <div className={styles.statusBar}>
        <span>{pending > 0 ? `${pending} change(s) pending sync` : "All changes synced"}</span>
        {syncError === "auth" && (
          <span className={styles.syncErr}>
            · Session expired — <a href="/login?next=/sessions" className={styles.reloginLink}>re-login to sync</a>
          </span>
        )}
        {syncError === "network" && pending > 0 && <span className={styles.syncErr}>· offline, will retry</span>}
        {syncError === "server" && <span className={styles.syncErr}>· sync error, will retry</span>}
      </div>

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
                  <SessionRow key={r.id} row={r} onOpen={open} onDelete={(id, label) => setConfirm({ id, label })} onReconcile={reconcile} onPull={pullFromServer} reconciling={reconciling === r.id} />
                ))}
              </ul>
            </>
          )}
          {finished.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Finished</div>
              <ul className={styles.list}>
                {finished.map((r) => (
                  <SessionRow key={r.id} row={r} onOpen={open} onDelete={(id, label) => setConfirm({ id, label })} onReconcile={reconcile} onPull={pullFromServer} reconciling={reconciling === r.id} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className={styles.links}>
        <Link href="/program">Program</Link>
        <Link href="/blocks">Blocks</Link>
        <Link href="/exercises">Exercises</Link>
        <Link href="/equipment">Equipment</Link>
      </div>

      {confirm && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal}>
            <h2 style={{ marginTop: 0 }}>Delete session?</h2>
            <p><strong>{confirm.label.trim() || "Ad-hoc"}</strong> and everything logged in it will be removed. This can&rsquo;t be undone.</p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.dangerBtn} onClick={doDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete session"}
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={() => setConfirm(null)} disabled={deleting}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SessionRow({ row, onOpen, onDelete, onReconcile, onPull, reconciling }: { row: Row; onOpen: (id: string) => void; onDelete: (id: string, label: string) => void; onReconcile: (id: string) => void; onPull: (id: string) => void; reconciling: boolean }) {
  const listMismatch = row.pendingSync && !row.conflict && !!row.pendingReason?.startsWith("list");
  return (
    <li className={styles.rowWrap}>
      <button className={styles.row} onClick={() => onOpen(row.id)}>
        <div className={styles.rowTop}>
          <span className={styles.rowTitle}>{row.label.trim() || "Ad-hoc"}</span>
          <span className={styles.rowWhen}>{whenLabel(row)}</span>
        </div>
        <div className={styles.rowSub}>
          <span>{describe(row.label, row.exerciseCount)}</span>
          {row.inProgress && <span className={`${styles.badge} ${styles.badgeProgress}`}>resume</span>}
          {row.pendingSync && (
            <span className={`${styles.badge} ${styles.badgePending}`} title={`Pending: ${row.pendingReason}`}>
              not synced · {row.pendingReason}
            </span>
          )}
        </div>
      </button>
      {listMismatch && (
        <button
          type="button"
          className={styles.rowReconcile}
          title="This session's exercise list disagrees with the server (a pre-fix stale sync). Re-push your local list; the server keeps any occurrence that still has logged sets."
          onClick={() => onReconcile(row.id)}
          disabled={reconciling}
        >
          {reconciling ? "…" : "Reconcile"}
        </button>
      )}
      {row.conflict && (
        <button
          type="button"
          className={styles.rowReconcile}
          title="The server has logged sets this device doesn't have — this device is the stale side. Pull the server's copy down to replace the local one (safe: your logged sets on the server are kept)."
          onClick={() => onPull(row.id)}
          disabled={reconciling}
        >
          {reconciling ? "…" : "Pull from server"}
        </button>
      )}
      <button
        type="button"
        className={styles.rowDelete}
        title="Delete session"
        aria-label="Delete session"
        onClick={() => onDelete(row.id, row.label)}
      >
        ✕
      </button>
    </li>
  );
}
