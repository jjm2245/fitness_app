"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import styles from "../log.module.css";
import { ExerciseSearch, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import { prettyDayName } from "@/lib/labels";
import { SessionBar } from "@/components/shell/SessionBar";
import { StrengthCard } from "@/components/session/StrengthCard";
import { CardioCard } from "@/components/session/CardioCard";
import type {
  BlockDetail,
  CardControls,
  LoggableOccurrence,
  ProgramDetail,
  ProgramExerciseDetail,
} from "@/components/session/shared";
import {
  discardSessionIfEmpty,
  getSessionSets,
  healSingletonDropGroups,
  getCompletedInstances,
  setOccurrenceCompleted,
  getSession,
  hydrateFromServer,
  finishSession,
  editSessionMeta,
  sync,
  pendingCount,
  addOccurrence,
  listOccurrences,
  moveOccurrence,
  removeOccurrence,
  getSessionCardio,
  type LocalSession,
  type SessionSet,
  type SessionCardio,
  type Occurrence,
  type AttachExercise,
} from "@/lib/sessionStore";

// The session screen (phase 2): this page is the ORCHESTRATOR — state, data
// loading, and sync live here; the cards and their machinery live in
// src/components/session/*. All handlers below are unchanged from the
// pre-rebuild page.

// Tap the session's date to correct it — a morning-after log or a corrupted
// stamp gets the TRUE date/time from the only honest source: the user. Saved
// with firstFinishedSource 'user' (traceable input, like a corrected rest);
// blank time = honest blank (no fabricated value). Fully offline: the edit is
// pending (metaDirty) until the PATCH drains.
function SessionDateEditor({ session, onChanged }: { session: LocalSession; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [dateVal, setDateVal] = useState(session.date);
  const [timeVal, setTimeVal] = useState("");

  function open() {
    setDateVal(session.date);
    if (session.firstFinishedAt) {
      const t = new Date(session.firstFinishedAt);
      setTimeVal(`${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`);
    } else setTimeVal("");
    setEditing(true);
  }

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return;
    let firstFinishedAt: string | null = null;
    if (timeVal) {
      const [y, m, d] = dateVal.split("-").map(Number);
      const [hh, mm] = timeVal.split(":").map(Number);
      firstFinishedAt = new Date(y, m - 1, d, hh, mm).toISOString(); // local wall clock → UTC storage
    }
    await editSessionMeta(session.id, { date: dateVal, firstFinishedAt });
    setEditing(false);
    onChanged();
  }

  const timeLabel = session.firstFinishedAt
    ? ` · ${new Date(session.firstFinishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";
  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        className={styles.secondaryBtn}
        style={{ fontWeight: 400, fontSize: 15 }}
        title={`Tap to correct this session's date/time${session.firstFinishedSource === "user" ? " — currently set by you" : ""}`}
      >
        {session.date}{timeLabel}{session.firstFinishedSource === "user" ? " · set by you" : ""} ✎
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 14, fontWeight: 400 }}>
      <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
      <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} title="Optional — leave blank for no time" />
      <button type="button" onClick={save} className={styles.primary}>Save</button>
      <button type="button" onClick={() => setEditing(false)} className={styles.secondaryBtn}>Cancel</button>
    </span>
  );
}

function FinishSummary({
  session, occurrences, completed, sessionSets, sessionCardio, pending, onConfirm, onClose,
}: {
  session: LocalSession;
  occurrences: Occurrence[];
  completed: Set<string>;
  sessionSets: SessionSet[];
  sessionCardio: SessionCardio[];
  pending: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // One row per performed occurrence, in order, with its own set/cardio/done —
  // regardless of source (bug 1b stays fixed under the occurrence model).
  const setsByInstance = new Map<string, number>();
  for (const s of sessionSets) setsByInstance.set(s.instanceId, (setsByInstance.get(s.instanceId) ?? 0) + 1);
  const cardioByInstance = new Map<string, number>();
  for (const c of sessionCardio) cardioByInstance.set(c.instanceId, (cardioByInstance.get(c.instanceId) ?? 0) + 1);

  const list = occurrences.map((o) => {
    const sets = setsByInstance.get(o.instanceId) ?? 0;
    const cardio = cardioByInstance.get(o.instanceId) ?? 0;
    const done = completed.has(o.instanceId);
    const bits: string[] = [];
    if (sets > 0) bits.push(`${sets} ${sets === 1 ? "set" : "sets"}`);
    if (cardio > 0) bits.push("cardio");
    if (bits.length === 0 && done) bits.push("done, no sets logged");
    return { instanceId: o.instanceId, name: o.exerciseName, desc: bits.join(" · ") };
  }).filter((r) => r.desc.length > 0);

  const setCount = sessionSets.length;

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <h2 style={{ marginTop: 0 }}>Finish session — {session.origin}</h2>
        <p>
          <strong>{setCount}</strong> {setCount === 1 ? "set" : "sets"} across <strong>{list.length}</strong>{" "}
          {list.length === 1 ? "exercise" : "exercises"}
          {sessionCardio.length > 0 && <> · <strong>{sessionCardio.length}</strong> cardio {sessionCardio.length === 1 ? "entry" : "entries"}</>}.
        </p>
        {list.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Nothing logged yet — you can still finish, or keep logging.</p>
        ) : (
          <ol style={{ paddingLeft: 18 }}>
            {list.map((r) => <li key={r.instanceId}>{r.name} — {r.desc}</li>)}
          </ol>
        )}
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          {pending > 0 ? `${pending} change(s) not yet synced — they'll sync when you're back online.` : "All changes synced."}
        </p>
        {session.finishedAt && (
          <p style={{ fontSize: 13, opacity: 0.7 }}>Previously finished at {new Date(session.finishedAt).toLocaleTimeString()} — finishing again re-stamps it.</p>
        )}
        <div className={styles.modalActions}>
          <button type="button" onClick={onConfirm} className={styles.primary}>Confirm finish</button>
          <button type="button" onClick={onClose}>Keep logging</button>
        </div>
      </div>
    </div>
  );
}

// The quick-add palette: tap any exercise to append it to the performed list.
// Program days and blocks are groups of one-tap chips; ad-hoc search + custom is
// always available. Adding is instant (the card appears above) and the palette
// stays open so you can add the next one mid-set.
function AddPalette({
  programs,
  blocks,
  onAdd,
  onAddAdhoc,
}: {
  programs: ProgramDetail[];
  blocks: BlockDetail[];
  onAdd: (ex: ProgramExerciseDetail, source: string) => void;
  onAddAdhoc: (r: ExerciseSearchResult) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Dedupe by label: the seed exposes e.g. "Abs"/"Cardio" as both a program day
  // and a reusable block — show each once (program day wins, added first).
  const groups: { key: string; label: string; source: string; exercises: ProgramExerciseDetail[] }[] = [];
  const seenLabels = new Set<string>();
  for (const prog of programs) {
    for (const d of prog.days) {
      const label = prettyDayName(d.name);
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      groups.push({ key: `d${d.id}`, label, source: label, exercises: d.exercises });
    }
  }
  for (const b of blocks) {
    if (seenLabels.has(b.name)) continue;
    seenLabels.add(b.name);
    groups.push({ key: `b${b.id}`, label: b.name, source: b.name, exercises: b.exercises });
  }

  return (
    <div className={styles.palette}>
      <div className={styles.paletteSearch}>
        <span style={{ fontSize: 13, opacity: 0.75 }}>Add any exercise:</span>
        <ExerciseSearch onPick={onAddAdhoc} placeholder="Search library / curated, or create custom…" />
      </div>
      <div className={styles.paletteGroups}>
        {groups.map((g) => (
          <div key={g.key} className={styles.paletteGroup}>
            <button
              type="button"
              className={styles.paletteGroupHeader}
              onClick={() => setOpenGroup((o) => (o === g.key ? null : g.key))}
            >
              {openGroup === g.key ? "▾" : "▸"} {g.label} <span style={{ opacity: 0.55 }}>({g.exercises.length})</span>
            </button>
            {openGroup === g.key && (
              <div className={styles.paletteChips}>
                {g.exercises.map((e) => (
                  <button key={e.id} type="button" className={styles.chipBtn} onClick={() => onAdd(e, g.source)}>
                    + {e.exerciseName}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LogSessionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<LocalSession | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound">("loading");
  const [blocks, setBlocks] = useState<BlockDetail[]>([]);
  const [allPrograms, setAllPrograms] = useState<ProgramDetail[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [sessionSets, setSessionSets] = useState<SessionSet[]>([]);
  const [sessionCardio, setSessionCardio] = useState<SessionCardio[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncError, setSyncError] = useState<"auth" | "network" | "server" | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);

  const refreshSession = useCallback(async () => {
    await healSingletonDropGroups(sessionId); // clear legacy stray "+ Drop" tags (idempotent)
    const [occ, sets, cardio, done, p, s] = await Promise.all([
      listOccurrences(sessionId), getSessionSets(sessionId), getSessionCardio(sessionId),
      getCompletedInstances(sessionId), pendingCount(sessionId), getSession(sessionId),
    ]);
    setOccurrences(occ);
    setSessionSets(sets);
    setSessionCardio(cardio);
    setCompleted(done);
    setPending(p);
    if (s) setSession(s);
  }, [sessionId]);

  const onSessionChanged = useCallback(async () => {
    await refreshSession();
    await sync().catch(() => {});
    await refreshSession();
  }, [refreshSession]);

  const handleSync = useCallback(async () => {
    const r = await sync();
    setSyncError(r.authError ? "auth" : r.networkError ? "network" : r.serverError ? "server" : null);
    setSyncStatus(`Synced: +${r.created} ~${r.updated} −${r.deleted}${r.finished ? ` finish×${r.finished}` : ""}${r.failed ? `, ${r.failed} still pending` : ""}`);
    await refreshSession();
  }, [refreshSession]);

  const toggleComplete = useCallback(async (instanceId: string, isComplete: boolean) => {
    await setOccurrenceCompleted(sessionId, instanceId, isComplete);
    await refreshSession();
  }, [sessionId, refreshSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let s = await getSession(sessionId);
      if (!s) {
        try {
          const res = await fetch(`/api/sessions/${sessionId}`);
          if (res.ok) s = await hydrateFromServer(await res.json());
        } catch {
          /* offline and not local — can't show it */
        }
      }
      if (cancelled) return;
      if (!s) {
        setLoadState("notfound");
        return;
      }
      setSession(s);
      setLoadState("ready");
      await refreshSession();

      const blocksRes = await fetch("/api/blocks").then((r) => (r.ok ? (r.json() as Promise<BlockDetail[]>) : []));
      if (cancelled) return;
      setBlocks(blocksRes);

      const summaries = await fetch("/api/programs").then((r) => (r.ok ? r.json() : []));
      const full = await Promise.all(
        (summaries as { id: number }[]).map((p) =>
          fetch(`/api/programs/${p.id}`).then((r) => (r.ok ? (r.json() as Promise<ProgramDetail>) : null))
        )
      );
      if (!cancelled) setAllPrograms(full.filter((p): p is ProgramDetail => p !== null));
    })();
    const onFocus = () => { if (document.visibilityState === "visible") handleSync(); };
    window.addEventListener("online", handleSync);
    window.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleSync);
      window.removeEventListener("visibilitychange", onFocus);
    };
  }, [sessionId, handleSync, refreshSession]);

  const loggables: LoggableOccurrence[] = useMemo(() => {
    return occurrences.map((o) => ({
      instanceId: o.instanceId,
      orderIndex: o.orderIndex,
      exerciseId: o.exerciseId,
      exerciseName: o.exerciseName,
      loadType: o.loadType,
      portable: o.portable,
      conditioningOnly: o.conditioningOnly,
      target: o.targetSets != null ? { targetSets: o.targetSets, repRange: o.repRange, rirTarget: o.rirTarget } : null,
      params: o.params,
      source: o.source,
      provenance: o.provenance,
      untagged: o.untagged,
      unilateral: o.unilateral ?? false,
    }));
  }, [occurrences]);

  const attachFrom = (e: ProgramExerciseDetail): AttachExercise => ({
    exerciseId: e.exerciseId,
    exerciseName: e.exerciseName,
    loadType: e.loadType,
    portable: e.portable,
    conditioningOnly: e.conditioningOnly,
    provenance: e.source,
    untagged: e.untagged,
    unilateral: e.unilateral ?? false,
    targetSets: e.targetSets,
    repRange: e.repRange,
    rirTarget: e.rirTarget,
    params: e.params,
  });

  async function addFromPalette(e: ProgramExerciseDetail, source: string) {
    await addOccurrence(sessionId, attachFrom(e), source);
    await refreshSession();
  }

  async function addAdhoc(r: ExerciseSearchResult) {
    await addOccurrence(
      sessionId,
      {
        exerciseId: r.id,
        exerciseName: r.name,
        loadType: r.loadType,
        portable: r.portable,
        conditioningOnly: r.conditioningOnly,
        provenance: r.source,
        untagged: r.untagged,
        unilateral: r.unilateral ?? false,
      },
      "Ad-hoc"
    );
    await refreshSession();
  }

  async function move(instanceId: string, dir: "up" | "down") {
    await moveOccurrence(sessionId, instanceId, dir);
    await refreshSession();
  }

  async function remove(instanceId: string) {
    await removeOccurrence(sessionId, instanceId);
    await onSessionChanged();
  }

  async function confirmFinish() {
    await finishSession(sessionId);
    setShowFinish(false);
    await sync().catch(() => {});
    router.push("/sessions");
  }

  if (loadState === "loading") {
    return <main className={styles.page}><p>Loading session…</p></main>;
  }
  if (loadState === "notfound" || !session) {
    return (
      <main className={styles.page}>
        <p>Session not found. It may only exist on another device — reconnect and open it from the <Link href="/sessions">sessions list</Link>.</p>
      </main>
    );
  }

  const totalLogged = sessionSets.length + sessionCardio.length;
  const date = session.date;

  return (
    <main className={styles.page}>
      <div className={styles.statusBar}>
        <span>{pending > 0 ? `${pending} change(s) pending sync` : "All changes synced"}</span>
        <button onClick={handleSync} className={styles.secondaryBtn}>Sync now</button>
        {syncError === "auth" ? (
          <span className={styles.syncErr}>
            Session expired —{" "}
            <a href={`/login?next=${encodeURIComponent(`/log/${sessionId}`)}`} className={styles.reloginLink}>re-login to sync</a>
          </span>
        ) : syncError === "network" ? (
          <span className={styles.syncErr}>Offline — {pending} change(s) will sync when you reconnect</span>
        ) : syncError === "server" ? (
          <span className={styles.syncErr}>Sync error — will retry</span>
        ) : null}
        {session.finishedAt && <span>· finished {new Date(session.finishedAt).toLocaleTimeString()}</span>}
        {syncStatus && !syncError && <span>· {syncStatus}</span>}
      </div>

      <h1>
        {session.origin}{" "}
        <SessionDateEditor session={session} onChanged={async () => { await refreshSession(); handleSync(); }} />
      </h1>

      <div className={styles.addRow}>
        <button type="button" onClick={() => setPaletteOpen((o) => !o)} className={styles.primary}>
          {paletteOpen ? "Hide add panel" : "+ Add exercise"}
        </button>
        <span style={{ fontSize: 13, opacity: 0.65 }}>Tap to add as you go — order is kept.</span>
      </div>

      {paletteOpen && (
        <AddPalette programs={allPrograms} blocks={blocks} onAdd={addFromPalette} onAddAdhoc={addAdhoc} />
      )}

      {loggables.length === 0 ? (
        <p style={{ opacity: 0.65 }}>Nothing added yet — add your first exercise above. Add more as you do them; the order is your session record.</p>
      ) : (
        <ol className={styles.list}>
          {loggables.map((ex, i) => {
            const controls: CardControls = {
              position: i,
              total: loggables.length,
              onMoveUp: () => move(ex.instanceId, "up"),
              onMoveDown: () => move(ex.instanceId, "down"),
              onRemove: () => remove(ex.instanceId),
            };
            return ex.conditioningOnly ? (
              <CardioCard
                key={ex.instanceId}
                ex={ex}
                sessionId={sessionId}
                date={date}
                controls={controls}
                sessionCardio={sessionCardio}
                completed={completed.has(ex.instanceId)}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
              />
            ) : (
              <StrengthCard
                key={ex.instanceId}
                ex={ex}
                sessionId={sessionId}
                date={date}
                controls={controls}
                sessionSets={sessionSets}
                completed={completed.has(ex.instanceId)}
                onSessionChanged={onSessionChanged}
                onToggleComplete={toggleComplete}
              />
            );
          })}
        </ol>
      )}

      {/* Session bar — replaces the global nav while logging (mode switch).
          Back chevron · live rest timer (mirrors the in-card timer) · Finish.
          Back first discards the session if it's still empty (zero
          occurrences/sets/cardio, unfinished, no user intent) so backing out
          of Start leaves no husk — the discard reads IndexedDB directly, so
          it can't act on stale React state. Deliberately wired to the back
          action, not component unmount: React StrictMode's dev double-invoke
          would fire an unmount discard on ENTRY and eat the session the user
          just started. Gesture/kill exits are covered by the History-load
          sweep instead. */}
      <SessionBar
        finishCount={totalLogged}
        onFinish={() => setShowFinish(true)}
        onBack={async () => {
          await discardSessionIfEmpty(sessionId).catch(() => {});
          if (window.history.length > 1) router.back();
          else router.push("/sessions");
        }}
      />

      {showFinish && (
        <FinishSummary
          session={session}
          occurrences={occurrences}
          completed={completed}
          sessionSets={sessionSets}
          sessionCardio={sessionCardio}
          pending={pending}
          onConfirm={confirmFinish}
          onClose={() => setShowFinish(false)}
        />
      )}
    </main>
  );
}
