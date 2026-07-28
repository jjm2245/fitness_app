"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./sessions.module.css";
import { TimelineNoteSheet, TimelineNoteView, type TimelineNote } from "./TimelineNoteSheet";
import { assignLanes, overflowAt, coversDate, chipRowIndex, rangeLabel, MAX_LANES, GAP_LABEL_DAYS, daysBetween } from "@/lib/timeline";
import {
  listLocalSessionSummaries,
  deleteSession,
  pendingSessionDeletes,
  reconcileFinishedFromServer,
  reconcileOccurrenceList,
  rehydrateLocalFromServer,
  isDeviceBehind,
  sweepEmptySessions,
  editSessionMeta,
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
  notes: string | null;
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
  // Session note (workout_logs.notes). Shown as a quiet indicator on the row
  // and editable in the row's expanded detail, so a session can be annotated
  // long after it was logged.
  notes: string | null;
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
/** Calendar-day arithmetic on a plain YYYY-MM-DD, built from LOCAL parts —
 *  `new Date("2026-07-14")` is UTC midnight and lands a day early west of
 *  Greenwich. */
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + delta);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Gutter width: 44px with one lane (the mock's figure, and enough for the spine
 * dot plus a rail), +8px per extra lane. On a 390px screen every pixel here is
 * taken from the session card, so it stays as tight as the geometry allows and
 * never reserves space for lanes that aren't in use.
 */
function gutterWidth(laneCount: number): number {
  return 44 + Math.max(0, laneCount - 1) * 8;
}

/**
 * REMOVED: the old note tile. Under rails a note isn't a tile at all — the
 * treatment was dropped rather than restyled, since its borders never matched
 * the session cards and there is nothing left for it to be.
 */
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
  // Timeline notes — the annotations that explain the stretches BETWEEN
  // sessions. Loaded alongside the list and interleaved by date below.
  const [tlNotes, setTlNotes] = useState<TimelineNote[]>([]);
  const [tlSheet, setTlSheet] = useState<{ note?: TimelineNote; start?: string; end?: string } | null>(null);
  // Read-first: tapping a rail or chip opens the note; Edit hands off to the
  // editor sheet above.
  const [tlView, setTlView] = useState<TimelineNote | null>(null);
  const loadTimeline = useCallback(async () => {
    try {
      const res = await fetch("/api/timeline-notes", { cache: "no-store" });
      if (res.ok) setTlNotes(await res.json());
    } catch { /* offline — the sessions list still works without them */ }
  }, []);
  useEffect(() => { void loadTimeline(); }, [loadTimeline]);
  const [deleting, setDeleting] = useState(false);
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  // Queued session deletes the server has not confirmed yet.
  const [stuckDeletes, setStuckDeletes] = useState<string[]>([]);

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
    setStuckDeletes(pendingSessionDeletes());
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
        notes: s.notes ?? null,
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
        notes: s.notes ?? prev?.notes ?? null,
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
  // Sessions and timeline notes woven into ONE newest-first stream, then
  // bucketed by month. A note is ordered by its start date, so a Jul 14–24
  // illness lands between the Jul 25 session and the Jul 13 one — exactly where
  // you're looking when you wonder what happened.
  //
  // A GAP marker is emitted between two sessions more than three days apart.
  // Three days rather than two: a rest day and a missed day are normal and
  // don't need explaining; a stretch longer than that is the thing that becomes
  // unreadable later. The marker carries the gap's own dates so "+ Add note"
  // arrives pre-filled and correct.
  type Item =
    | { t: "session"; key: string; date: string; row: Row }
    | { t: "gap"; key: string; date: string; days: number }
    /** A note's marker gets its OWN row. Rendered inside a session's content it
     *  read as part of that session's entry — the thing being fixed here. */
    | { t: "chip"; key: string; date: string; note: TimelineNote };

  const todayIso = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);

  // Sessions are the NODES of the timeline; notes never enter this list, because
  // a note is a rail beside the spine rather than an entry in it. That is what
  // guarantees a note can't displace a session.
  const tlRows = useMemo(() => {
    const items: Item[] = [];
    for (let i = 0; i < finished.length; i++) {
      const r = finished[i];
      items.push({ t: "session", key: `s${r.id}`, date: r.date, row: r });
      const next = finished[i + 1];
      if (next) {
        const days = daysBetween(next.date, r.date) - 1;
        // A LABEL only — no affordance. Prompting on every rest gap would push
        // the owner to annotate ordinary rhythm, and once some gaps carry notes
        // and others don't, absence stops meaning anything. That would break
        // the export's own promise that silence is never evidence.
        if (days >= GAP_LABEL_DAYS) items.push({ t: "gap", key: `g${r.id}`, date: r.date, days });
      }
    }
    return items;
  }, [finished]);

  // Rail layout, computed once over every note.
  const lanes = useMemo(() => assignLanes(tlNotes, todayIso), [tlNotes, todayIso]);
  const rowDates = useMemo(() => tlRows.map((it) => it.date), [tlRows]);

  // Chips spliced in as their own rows, immediately ABOVE the row they anchor
  // to. Sessions keep their positions — a chip row is another item in the same
  // sorted stream, never something wrapped around a session.
  const withChips = useMemo(() => {
    const out: Item[] = [];
    tlRows.forEach((it, idx) => {
      for (const n of tlNotes) {
        if (chipRowIndex(n, rowDates, todayIso) === idx) {
          out.push({ t: "chip", key: `c${n.id}`, date: it.date, note: n });
        }
      }
      out.push(it);
    });
    return out;
  }, [tlRows, tlNotes, rowDates, todayIso]);
  const laneCount = useMemo(
    () => Math.min(MAX_LANES, Math.max(0, ...[...lanes.values()].map((l) => (l == null ? 0 : l + 1)))),
    [lanes]
  );

  const months = useMemo(() => {
    const out: Array<{ label: string; items: Array<Item & { idx: number }> }> = [];
    withChips.forEach((it, idx) => {
      const label = monthLabel(it.date);
      const bucket = out.at(-1);
      const withIdx = { ...it, idx };
      if (bucket && bucket.label === label) bucket.items.push(withIdx);
      else out.push({ label, items: [withIdx] });
    });
    return out;
  }, [withChips]);

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
      <div className={styles.titleRow}>
        <h1 className={styles.title}>History</h1>
        {/* The general entry point. The on-gap affordance covers the motivating
            case, but plenty of notes ("started a new job, sleeping badly",
            "began a cut") belong on a normal week with sessions either side —
            and those have no gap to hang off. */}
        <button type="button" className={styles.tlAddBtn} onClick={() => setTlSheet({})}>
          + Note
        </button>
      </div>

      {syncError === "auth" && (
        <div className={styles.authBanner}>
          Session expired — <a href="/login?next=/sessions">re-login to sync</a>
        </div>
      )}

      {/* A queued delete wipes the local row immediately, so one that never
          reaches the server leaves NO visible trace — the same invisible
          failure that let seven undeletable sessions accumulate. Say it out
          loud instead, and offer the retry. */}
      {stuckDeletes.length > 0 && (
        <div className={styles.authBanner}>
          {stuckDeletes.length} session{stuckDeletes.length === 1 ? "" : "s"} deleted here but not yet on the server.{" "}
          <button type="button" className={styles.linkBtn} onClick={() => { void drain().then(refresh); }}>
            Retry now
          </button>
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
                  <SessionRow key={r.id} row={r} {...rowProps} reconciling={reconciling === r.id} detailOpen={openDetail === r.id} syncError={syncError} onNoteSaved={refresh} />
                ))}
              </ul>
            </>
          )}
          {months.map((m) => (
            <div key={m.label}>
              <div className={styles.sectionLabel}>{m.label}</div>
              <ul className={styles.tlList}>
                {m.items.map((it) => (
                  <li key={it.key} className={styles.tlItem}>
                    {/* GUTTER: the spine dot plus one rail segment per active
                        span. Segments are per-row and stack vertically, so
                        contiguous rows join into a continuous line without any
                        measurement — variable row heights just work. */}
                    <span className={styles.tlGutter} style={{ width: gutterWidth(laneCount) }} aria-hidden="true">
                      {Array.from({ length: laneCount }, (_, lane) => {
                        const span = tlNotes.find(
                          (n) => lanes.get(n.id) === lane && coversDate(n, it.date, todayIso)
                        );
                        return (
                          <span key={lane} className={styles.tlLane}>
                            {span && <span className={styles.tlRail} data-kind={span.kind ?? "other"} />}
                          </span>
                        );
                      })}
                      {it.t === "session" && <span className={styles.tlNode} />}
                    </span>

                    <span className={styles.tlContent} data-chip={it.t === "chip" ? "" : undefined}>
                      {it.t === "session" ? (
                        <SessionRow asDiv row={it.row} {...rowProps} reconciling={reconciling === it.row.id} detailOpen={openDetail === it.row.id} syncError={syncError} onNoteSaved={refresh} />
                      ) : it.t === "chip" ? (
                        // A PILL on its own row — bordered and coloured by kind.
                        // Rendered inside a session's content it read as part of
                        // that session's entry; a note is a marker beside the
                        // timeline, not a field on a workout.
                        <button
                          type="button"
                          className={styles.tlChip}
                          data-kind={it.note.kind ?? "other"}
                          onClick={() => setTlView(it.note)}
                          title={it.note.notes}
                        >
                          <span className={styles.tlDot} data-kind={it.note.kind ?? "other"} aria-hidden="true" />
                          <span className={styles.tlChipText}>{it.note.notes}</span>
                          <span className={styles.tlChipRange}>· {rangeLabel(it.note, shortDay)}</span>
                        </button>
                      ) : (
                        // A label, deliberately with NO affordance — orientation
                        // only, above a week.
                        <span className={styles.gapText}>{it.days} days without a session</span>
                      )}
                      {overflowAt(tlNotes, lanes, it.date, todayIso) > 0 && it.t === "session" && (
                        <span className={styles.tlOverflow}>+{overflowAt(tlNotes, lanes, it.date, todayIso)} more</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {tlView && (
        <TimelineNoteView
          note={tlView}
          onClose={() => setTlView(null)}
          onSaved={loadTimeline}
          onEdit={() => { const n = tlView; setTlView(null); setTlSheet({ note: n }); }}
        />
      )}

      {tlSheet && (
        <TimelineNoteSheet
          note={tlSheet.note}
          defaultStart={tlSheet.start}
          defaultEnd={tlSheet.end}
          onClose={() => setTlSheet(null)}
          onSaved={loadTimeline}
        />
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
  asDiv,
  row,
  onOpen,
  onDelete,
  onReconcile,
  onPull,
  onToggleDetail,
  reconciling,
  detailOpen,
  syncError,
  onNoteSaved,
}: {
  /** Render as a <div> when the timeline wraps it in its own <li> — an <li>
   *  inside an <li> is invalid and React says so. */
  asDiv?: boolean;
  row: Row;
  onOpen: (id: string) => void;
  onDelete: (id: string, label: string) => void;
  onReconcile: (id: string) => void;
  onPull: (id: string) => void;
  onToggleDetail: (id: string) => void;
  onNoteSaved: () => void;
  reconciling: boolean;
  detailOpen: boolean;
  syncError: "auth" | "network" | "server" | null;
}) {
  // Dot semantics: green = in sync; amber = pending, drains on its own;
  // red = needs a decision (divergence) or sync is erroring.
  // <li> inside the timeline's own <li> is invalid markup; a <div> is the same
  // box without the nesting error.
  const Wrap = (asDiv ? "div" : "li") as "div" | "li";
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
    <Wrap className={styles.rowWrap}>
      <div className={styles.rowLine}>
        <button className={styles.row} onClick={() => onOpen(row.id)}>
          <div className={styles.rowTop}>
            <span className={styles.rowTitle}>
              {row.label.trim() || "Ad-hoc"}
              {/* Findable later: a session carrying a note says so on the row
                  itself, so you don't have to open every one to locate it. */}
              {row.notes ? <span className={styles.noteMark} title={row.notes}> · note</span> : null}
            </span>
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
          {/* Editing a note AFTER the fact is the point — most of what you'd
              want to record about a session (it aggravated a shoulder, you
              slept badly) is clearer in hindsight than mid-workout. */}
          <NoteEditor id={row.id} initial={row.notes} onSaved={onNoteSaved} />
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
    </Wrap>
  );
}


// A session note, editable from History. Writes through the SAME local-store
// path the session screen uses (`editSessionMeta` → metaDirty → the meta
// PATCH), so an edit made offline drains with everything else rather than
// needing its own queue.
function NoteEditor({ id, initial, onSaved }: { id: string; initial: string | null; onSaved: () => void }) {
  const [val, setVal] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div className={styles.noteRow}>
      <textarea
        className={styles.noteBox}
        value={val}
        onChange={(e) => { setVal(e.target.value); setDone(false); }}
        placeholder="note about this session (optional)"
        aria-label="Session note"
        rows={2}
      />
      <button
        type="button"
        disabled={saving || (val.trim() || null) === (initial ?? null)}
        onClick={async () => {
          setSaving(true);
          // Empty clears to NULL — "no note" stays one state, not two.
          await editSessionMeta(id, { notes: val.trim() || null });
          await sync().catch(() => {});
          setSaving(false);
          setDone(true);
          onSaved();
        }}
      >
        {saving ? "Saving…" : done ? "Saved" : "Save note"}
      </button>
    </div>
  );
}
