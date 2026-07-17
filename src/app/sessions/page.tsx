"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./sessions.module.css";
import {
  listLocalSessionSummaries,
  deleteSession,
  reconcileFinishedFromServer,
  reconcileOccurrenceList,
  rehydrateLocalFromServer,
  isDeviceBehind,
  sweepEmptySessions,
  sync,
  pendingCount,
  type LocalSessionSummary,
} from "@/lib/sessionStore";

// History — where finished sessions live (in-progress ones surface on top so
// nothing active is buried). The list merges the durable local store with the
// server's finished sessions, keyed by session id, so it renders fully
// offline. Shell restyle: month groups, quieter rows, and a per-row sync
// status dot (green synced / amber pending / red needs-action) that expands
// detail — including the directional heals — on tap. Starting a session moved
// to Home and Train; open/delete/sync behavior is unchanged.

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
  createdAt: string | null; // local store only — drives the duration readout
  inProgress: boolean;
  onServer: boolean;
  local: boolean;
  pendingSync: boolean;
  // Why it's pending — surfaced in the dot's expanded detail so "not synced"
  // is never a mystery. null when fully synced.
  pendingReason: string | null;
  // This device is the stale side (server has sets it lacks) — offer "pull
  // from server" instead of "Reconcile" (which would be a no-op here).
  conflict: boolean;
  // Multi-device divergence: the server has occurrences this device never saw
  // and local has nothing pending. Detect-and-warn — offer BOTH directions.
  behind: boolean;
}

// Month bucket key/label from the STABLE session date (local calendar parts —
// new Date("YYYY-MM-DD") is UTC midnight and would shift the month).
function monthLabel(dateIso: string): string {
  const [y, m] = dateIso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// date · time · duration — from the stable anchors only. Duration is shown
// when the local copy carries a plausible createdAt→firstFinishedAt span
// (1 min – 6 h); hydrated/server rows omit it rather than guess.
function whenLabel(row: Row): string {
  const [y, m, d] = row.date.split("-").map(Number);
  const dateLabel = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const parts = [dateLabel];
  if (row.firstFinishedAt) {
    parts.push(new Date(row.firstFinishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    if (row.createdAt) {
      const mins = Math.round((new Date(row.firstFinishedAt).getTime() - new Date(row.createdAt).getTime()) / 60_000);
      if (mins >= 1 && mins <= 360) parts.push(`${mins} min`);
    }
  }
  return parts.join(" · ");
}

export default function SessionsPage() {
  const router = useRouter();
  const [local, setLocal] = useState<LocalSessionSummary[]>([]);
  const [server, setServer] = useState<ServerSession[]>([]);
  const [, setPending] = useState(0);
  const [syncError, setSyncError] = useState<"auth" | "network" | "server" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  const drain = useCallback(async () => {
    const r = await sync().catch(() => null);
    if (r) setSyncError(r.authError ? "auth" : r.networkError ? "network" : r.serverError ? "server" : null);
  }, []);

  const refresh = useCallback(async () => {
    // Backstop husk sweep: discard local unfinished sessions that are still
    // completely empty (zero occurrences/sets/cardio, no user intent) and
    // older than ~5 min — the exits the session-bar back handler can't see
    // (PWA swiped away, browser back-gesture). Content-bearing sessions are
    // never touched; see discardSessionIfEmpty.
    await sweepEmptySessions().catch(() => {});
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
        createdAt: null,
        inProgress: !s.finishedAt,
        onServer: true,
        local: false,
        pendingSync: false,
        pendingReason: null,
        conflict: false,
        behind: false,
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
      // Multi-device divergence (Part 3): the server holds occurrences this device
      // never saw AND local is clean → this device is purely behind. Detected here
      // so it routes to Pull, not the no-op Reconcile that a raw count mismatch
      // would otherwise imply. Never auto-heals — the row offers both directions.
      const behind = isDeviceBehind({
        onServer: !!prev?.onServer,
        localExerciseCount: s.exerciseCount,
        serverExerciseCount: serverCount,
        finishSynced: s.finishSynced,
        occurrencesDirty: s.occurrencesDirty,
        metaDirty: s.metaDirty,
        occurrenceConflict: s.occurrenceConflict,
      });
      // A count mismatch that ISN'T a clean server-ahead divergence is a local
      // list change waiting to push (Reconcile). `behind` peels off the other
      // direction first so we don't mislabel it.
      const listPending = !behind && s.exerciseCount !== serverCount;
      // Conflict wins: the server proved it holds logged sets this device is
      // missing, so re-POSTing local is a dead end — the heal is to pull down.
      const conflict = !!s.occurrenceConflict;
      const metaPending = !!s.metaDirty;
      const reason = conflict
        ? "this device is behind"
        : behind
        ? `changed on another device · server ${serverCount} / local ${s.exerciseCount}`
        : finishPending
        ? "finish"
        : metaPending
        ? "date/time edit"
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
        createdAt: s.createdAt ?? null,
        inProgress: !s.finishedAt,
        onServer: prev?.onServer ?? false,
        local: true,
        pendingSync: reason !== null,
        pendingReason: reason,
        conflict,
        behind,
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

  // Finished rows bucketed by month of the stable session date.
  const months = useMemo(() => {
    const out: Array<{ label: string; rows: Row[] }> = [];
    for (const r of finished) {
      const label = monthLabel(r.date);
      const bucket = out.at(-1);
      if (bucket && bucket.label === label) bucket.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [finished]);

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
    } finally {
      setDeleting(false);
    }
  }

  const rowProps = {
    onOpen: open,
    onDelete: (id: string, label: string) => setConfirm({ id, label }),
    onReconcile: reconcile,
    onPull: pullFromServer,
    onToggleDetail: (id: string) => setOpenDetail((cur) => (cur === id ? null : id)),
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>History</h1>

      {syncError === "auth" && (
        <div className={styles.authBanner}>
          Session expired — <a href="/login?next=/sessions">re-login to sync</a>
        </div>
      )}

      {!loaded ? (
        <p className={styles.empty}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No sessions yet. Start one from Home.</p>
      ) : (
        <>
          {inProgress.length > 0 && (
            <>
              <div className={styles.sectionLabel}>In progress</div>
              <ul className={styles.list}>
                {inProgress.map((r) => (
                  <SessionRow key={r.id} row={r} {...rowProps} reconciling={reconciling === r.id} detailOpen={openDetail === r.id} syncError={syncError} />
                ))}
              </ul>
            </>
          )}
          {months.map((m) => (
            <div key={m.label}>
              <div className={styles.sectionLabel}>{m.label}</div>
              <ul className={styles.list}>
                {m.rows.map((r) => (
                  <SessionRow key={r.id} row={r} {...rowProps} reconciling={reconciling === r.id} detailOpen={openDetail === r.id} syncError={syncError} />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

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

function SessionRow({
  row,
  onOpen,
  onDelete,
  onReconcile,
  onPull,
  onToggleDetail,
  reconciling,
  detailOpen,
  syncError,
}: {
  row: Row;
  onOpen: (id: string) => void;
  onDelete: (id: string, label: string) => void;
  onReconcile: (id: string) => void;
  onPull: (id: string) => void;
  onToggleDetail: (id: string) => void;
  reconciling: boolean;
  detailOpen: boolean;
  syncError: "auth" | "network" | "server" | null;
}) {
  // Dot semantics: green = in sync; amber = pending, drains on its own;
  // red = needs a decision (divergence) or sync is erroring.
  const needsAction = row.conflict || row.behind;
  const dotClass = needsAction || (row.pendingSync && syncError && syncError !== "network")
    ? styles.dotRed
    : row.pendingSync
    ? styles.dotAmber
    : styles.dotGreen;
  const dotLabel = needsAction ? "Needs attention" : row.pendingSync ? "Pending sync" : "Synced";

  const listMismatch = row.pendingSync && !row.conflict && !row.behind && !!row.pendingReason?.startsWith("list");
  const showPull = row.conflict || row.behind;
  const showReconcile = listMismatch || row.behind;
  const pullTitle = row.behind
    ? "This session was changed on another device — it has exercises this device doesn't. Pull the server's copy down to adopt those changes (replaces the local copy; nothing on the server is lost)."
    : "The server has logged sets this device doesn't have — this device is the stale side. Pull the server's copy down to replace the local one (safe: your logged sets on the server are kept).";
  const reconcileTitle = row.behind
    ? "Keep THIS device's version instead: re-push the local exercise list to the server. The server keeps any occurrence that still has logged sets (history-safe), so this can't delete logged data."
    : "This session's exercise list disagrees with the server (a pre-fix stale sync). Re-push your local list; the server keeps any occurrence that still has logged sets.";

  // Always the exercise count — it exists for every row (local AND
  // server-only), so the list reads consistently. Set counts only exist on
  // local copies and made the list look ragged (owner call, polish round 2).
  const count = `${row.exerciseCount} exercise${row.exerciseCount === 1 ? "" : "s"}`;

  return (
    <li className={styles.rowWrap}>
      <div className={styles.rowLine}>
        <button className={styles.row} onClick={() => onOpen(row.id)}>
          <div className={styles.rowTop}>
            <span className={styles.rowTitle}>{row.label.trim() || "Ad-hoc"}</span>
            {row.inProgress && <span className={styles.badgeProgress}>resume</span>}
          </div>
          <div className={styles.rowSub}>
            <span>{row.inProgress ? "In progress" : whenLabel(row)}</span>
            <span>·</span>
            <span>{count}</span>
          </div>
        </button>
        <button
          type="button"
          className={styles.dotBtn}
          title={dotLabel}
          aria-label={`Sync: ${dotLabel}`}
          onClick={() => onToggleDetail(row.id)}
        >
          <span className={`${styles.dot} ${dotClass}`} />
        </button>
        <button
          type="button"
          className={styles.delete}
          title="Delete session"
          aria-label="Delete session"
          onClick={() => onDelete(row.id, row.label)}
        >
          ✕
        </button>
      </div>

      {detailOpen && (
        <div className={styles.syncDetail}>
          <span>
            {needsAction
              ? row.pendingReason
              : row.pendingSync
              ? `Pending: ${row.pendingReason} — syncs automatically when online.`
              : "Synced with the server."}
          </span>
          {(showPull || showReconcile) && (
            <div className={styles.syncActions}>
              {showReconcile && (
                <button type="button" title={reconcileTitle} onClick={() => onReconcile(row.id)} disabled={reconciling}>
                  {reconciling ? "…" : row.behind ? "Keep this device" : "Reconcile"}
                </button>
              )}
              {showPull && (
                <button type="button" title={pullTitle} onClick={() => onPull(row.id)} disabled={reconciling}>
                  {reconciling ? "…" : "Pull from server"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
