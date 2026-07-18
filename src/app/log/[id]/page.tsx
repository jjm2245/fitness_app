"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { ExerciseSearchResult } from "@/components/ExerciseSearch";
import { SessionBar } from "@/components/shell/SessionBar";
import { StrengthCard } from "@/components/session/StrengthCard";
import { CardioCard } from "@/components/session/CardioCard";
import { FinishSheet } from "@/components/session/FinishSheet";
import { SessionHeader } from "@/components/session/SessionHeader";
import { AddSheet } from "@/components/session/AddSheet";
import sessionStyles from "@/components/session/session.module.css";
import type {
  BlockDetail,
  CardControls,
  LoggableOccurrence,
  ProgramDetail,
  ProgramExerciseDetail,
} from "@/components/session/shared";
import {
  discardSessionIfEmpty,
  rehydrateLocalFromServer,
  reconcileOccurrenceList,
  getSessionSets,
  healSingletonDropGroups,
  getCompletedInstances,
  setOccurrenceCompleted,
  getSession,
  hydrateFromServer,
  finishSession,
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
  const [syncError, setSyncError] = useState<"auth" | "network" | "server" | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  // The add palette is a sheet now — the exercise list is the default view.
  const [addOpen, setAddOpen] = useState(false);

  // Husk discard, trigger 2 of 2 (owner call: keep BOTH). The back button's
  // onClick handles the common path race-free; this unmount cleanup catches
  // the browser/iOS back GESTURE (a route change, not a button tap). The
  // pathname guard is the StrictMode dodge: the dev double-invoke unmounts
  // with the pathname UNCHANGED (still this session's URL) → skipped; a real
  // navigation has already updated the URL by cleanup time → discard fires.
  // deleteSession is idempotent, so double-firing with the button is harmless.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.location.pathname !== `/log/${sessionId}`) {
        discardSessionIfEmpty(sessionId).catch(() => {});
      }
    };
  }, [sessionId]);

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

  // The directional heals, same semantics as History's row detail.
  async function pullFromServer() {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        await rehydrateLocalFromServer(await res.json());
        await refreshSession();
      }
    } catch { /* offline — nothing to pull */ }
  }
  async function reconcile() {
    await reconcileOccurrenceList(sessionId);
    await refreshSession();
  }

  if (loadState === "loading") {
    return <main className={sessionStyles.page}><p>Loading session…</p></main>;
  }
  if (loadState === "notfound" || !session) {
    return (
      <main className={sessionStyles.page}>
        <p>Session not found. It may only exist on another device — reconnect and open it from the <Link href="/sessions">sessions list</Link>.</p>
      </main>
    );
  }

  const totalLogged = sessionSets.length + sessionCardio.length;
  const date = session.date;

  return (
    <main className={sessionStyles.page}>
      <SessionHeader
        session={session}
        pending={pending}
        syncError={syncError}
        onChanged={async () => { await refreshSession(); handleSync(); }}
        onSyncNow={handleSync}
        onPull={pullFromServer}
        onReconcile={reconcile}
      />

      {loggables.length === 0 ? (
        <p className={sessionStyles.emptyPrompt}>Add your first exercise — the order you log is your session record.</p>
      ) : (
        <ol className={sessionStyles.cardList}>
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

      {addOpen && (
        <AddSheet
          programs={allPrograms}
          blocks={blocks}
          onAdd={addFromPalette}
          onAddAdhoc={addAdhoc}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Session bar — replaces the global nav while logging (mode switch).
          Back chevron · live rest timer (mirrors the in-card timer) · Finish.
          Husk discard trigger 1 of 2: the back button's onClick discards an
          empty session BEFORE navigating, so History's first render is clean
          (no race). The unmount+pathname cleanup above is trigger 2, for the
          back gesture; deleteSession is idempotent so both firing is fine. */}
      <SessionBar
        finishCount={totalLogged}
        onFinish={() => setShowFinish(true)}
        onAdd={() => setAddOpen(true)}
        onBack={async () => {
          await discardSessionIfEmpty(sessionId).catch(() => {});
          if (window.history.length > 1) router.back();
          else router.push("/sessions");
        }}
      />

      {showFinish && (
        <FinishSheet
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
