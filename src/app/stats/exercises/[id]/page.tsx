"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "../../stats.module.css";
import { deltaText, type Delta, type LaneMode } from "@/lib/statsShape";
import { useWeightUnit } from "@/lib/useUnit";
import { displayLb, lbToKg } from "@/lib/units";
import { StatsChart, type ChartPoint } from "@/components/stats/StatsChart";
import { NumberInput } from "@/components/NumberInput";

// /stats/exercises/[id] — one exercise's full history.
//
// Chart view = charts + the FULL session list beneath (one screen, both
// reads); List view = rows only. Sessions keyed on workout_logs.id. A machine
// with one session renders no chart — the quiet line explains why. Tapping a
// chart point scrolls to and briefly highlights that session's row.
//
// Combine flow: any undecided machine pair raises the card (once per pair) in
// Chart view. Decisions render as merged chart / scaled estimate / separate
// sections; every state carries a one-tap way back in. Estimates never mint
// PRs, never enter deltas, never touch bests — List and the index are
// byte-identical under any decision or factor.

interface SessionRow {
  workoutLogId: number;
  date: string;
  lane: string;
  machineTag: string;
  machineTagKind: "unit" | "unspecified" | "none";
  laneMode: LaneMode;
  figure: { load: number; reps: number } | null;
  repsList: number[] | null;
  setsCount: number;
  delta: Delta;
  deltaHasUnit: boolean;
  isPr: boolean;
}

interface Decision {
  id: number;
  a: string;
  b: string;
  kind: "same_setup" | "ratio_estimate";
  status: "confirmed" | "rejected";
  basis: string;
  factor: number | null;
}

interface Pair {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  situation: "match" | "differ" | "unknown";
  specBasis: string | null;
  anchor: string;
  estimated: string;
  decision: Decision | null;
}

interface Payload {
  exerciseId: string;
  name: string;
  sessionCount: number;
  machineCount: number;
  dateRange: { from: string; to: string };
  bests: Array<{ lane: string; machineTag: string; laneMode: LaneMode; load?: number; reps?: number; date: string }>;
  sessions: SessionRow[];
  chart: Array<{ lane: string; machineTag: string; laneMode: LaneMode; points: ChartPoint[] }>;
  comparability: { pairs: Pair[] };
}

const VIEW_KEY = "fitness-app:stats-view";
const SORT_KEY = "fitness-app:stats-session-sort";
type RowSort = "date" | "value";

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ExerciseStatsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const exerciseId = decodeURIComponent(params.id);
  const [data, setData] = useState<Payload | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<"list" | "chart">("list");
  const [rowSort, setRowSort] = useState<RowSort>("date");
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The combine card: open pair + prefill (reopened decisions land here too).
  const [cardPair, setCardPair] = useState<Pair | null>(null);
  const [cardMode, setCardMode] = useState<"same" | "scaled" | null>(null);
  const [cardFactor, setCardFactor] = useState("2");

  useEffect(() => {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === "chart") setView("chart");
    const s = window.localStorage.getItem(SORT_KEY);
    if (s === "value") setRowSort("value");
  }, []);
  function pickView(v: "list" | "chart") {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  }
  function pickSort(s: RowSort) {
    setRowSort(s);
    try {
      window.localStorage.setItem(SORT_KEY, s);
    } catch {
      /* private mode */
    }
  }

  const [wUnit] = useWeightUnit();
  const w = useCallback((lb: number) => (wUnit === "kg" ? lbToKg(lb) : displayLb(lb)), [wUnit]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/stats/exercises/${encodeURIComponent(exerciseId)}`, { cache: "no-store" });
    if (res.status === 404) return setMissing(true);
    if (!res.ok) return;
    setData(await res.json());
  }, [exerciseId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function writeDecision(pair: Pair, kind: "same_setup" | "ratio_estimate", status: "confirmed" | "rejected", factor?: number) {
    const basis =
      status === "rejected"
        ? "owner-declared kept separate"
        : kind === "same_setup"
        ? pair.specBasis ?? "owner-declared same setup"
        : `owner-declared ×${factor} (${labelFor(pair, pair.estimated)} ×${factor} → ${labelFor(pair, pair.anchor)})`;
    await fetch("/api/stats/comparability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: pair.a, b: pair.b, kind, status, basis, factor: kind === "ratio_estimate" ? factor : null }),
    });
    setCardPair(null);
    setCardMode(null);
    await refresh();
  }

  function labelFor(pair: Pair, id: string) {
    return id === pair.a ? pair.aLabel : pair.bLabel;
  }

  function openCard(pair: Pair) {
    setCardPair(pair);
    const d = pair.decision;
    if (d && d.status === "confirmed" && d.kind === "ratio_estimate") {
      setCardMode("scaled");
      setCardFactor(String(d.factor ?? 2));
    } else if (d && d.status === "confirmed") {
      setCardMode("same");
    } else {
      setCardMode(null);
      setCardFactor("2");
    }
  }

  function tapPoint(workoutLogId: number, lane?: string) {
    const key = `sess-${workoutLogId}-${lane ?? ""}`;
    const el = document.getElementById(key) ?? document.querySelector(`[id^="sess-${workoutLogId}-"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(el.id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1600);
  }

  if (missing)
    return (
      <main className={styles.page}>
        <p className={styles.note}>No history for this exercise yet.</p>
      </main>
    );
  if (!data)
    return (
      <main className={styles.page}>
        <p className={styles.note}>Loading…</p>
      </main>
    );

  const isRepsExercise = data.sessions.every((s) => s.laneMode === "reps");
  const sortedSessions = [...data.sessions].sort((a, b) => {
    if (rowSort === "value") {
      const va = a.laneMode === "reps" ? a.figure?.reps ?? 0 : a.figure?.load ?? 0;
      const vb = b.laneMode === "reps" ? b.figure?.reps ?? 0 : b.figure?.load ?? 0;
      return vb - va || b.date.localeCompare(a.date);
    }
    return a.date === b.date ? b.workoutLogId - a.workoutLogId : b.date.localeCompare(a.date);
  });

  // Chart composition under decisions. Confirmed pairs collapse two lanes into
  // one chart (merged or estimated); everything else renders per-machine.
  const confirmed = data.comparability.pairs.filter((p) => p.decision?.status === "confirmed");
  const mergedLanes = new Set(confirmed.flatMap((p) => [p.a, p.b]));
  const soloCharts = data.chart.filter((c) => !mergedLanes.has(c.lane));
  const undecidedPairs = data.comparability.pairs.filter((p) => p.decision == null);
  const rejectedPairs = data.comparability.pairs.filter((p) => p.decision?.status === "rejected");

  const sessionList = (
    <ul className={styles.sessList}>
      {sortedSessions.map((s) => (
        <li
          key={`${s.workoutLogId}-${s.lane}`}
          id={`sess-${s.workoutLogId}-${s.lane}`}
          className={`${styles.sessRow} ${highlight === `sess-${s.workoutLogId}-${s.lane}` ? styles.sessRowHot : ""}`}
        >
          <div className={styles.sessTop}>
            <span className={styles.sessFigure}>
              {s.laneMode === "reps"
                ? s.repsList && s.repsList.length > 0
                  ? `${s.repsList.join(", ")} reps`
                  : "—"
                : s.figure
                ? `${w(s.figure.load)} ${wUnit} × ${s.figure.reps}`
                : "—"}
            </span>
            {s.isPr && s.laneMode === "loaded" && (
              <span className={styles.prChip} title="Personal record on this machine when logged">
                <span aria-hidden="true">★</span> PR
              </span>
            )}
          </div>
          <div className={styles.sessSub}>
            {shortDay(s.date)}
            <span className={styles.metaDot}> · </span>
            {s.machineTagKind === "unspecified" ? <span className={styles.mTagUnspec}>unspecified</span> : s.machineTag}
            <span className={styles.metaDot}> · </span>
            {s.setsCount} {s.setsCount === 1 ? "set" : "sets"}
          </div>
          <div className={s.delta.tier === "bright" ? styles.tierBright : styles.tierQuiet}>
            {deltaText(s.delta, w, wUnit, s.deltaHasUnit)}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <main className={styles.page}>
      <header className={styles.exHeader}>
        {/* Back to the index — present on BOTH views. */}
        <button type="button" className={styles.backLink} onClick={() => router.push("/stats/exercises")} aria-label="Back to exercises">
          ‹ Exercises
        </button>
        <h1 className={styles.title}>{data.name}</h1>
        <p className={styles.exHeaderSub}>
          {data.sessionCount} {data.sessionCount === 1 ? "session" : "sessions"} ·{" "}
          {data.machineCount >= 1
            ? `${data.machineCount} ${data.machineCount === 1 ? "machine" : "machines"}`
            : "no machine"}{" "}
          · {shortDay(data.dateRange.from)} – {shortDay(data.dateRange.to)}
        </p>
        <p className={styles.bestsLine}>
          {data.bests.map((b, i) => (
            <span key={b.lane}>
              {i > 0 && <span className={styles.metaDot}> · </span>}
              {b.laneMode === "loaded" ? (
                <>
                  <span className={styles.figLabel}>best </span>
                  <span className={styles.figMono}>
                    {w(b.load!)} {wUnit}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.figLabel}>last </span>
                  <span className={styles.figMono}>{b.reps} reps</span>
                </>
              )}
              {data.bests.length > 1 && <span className={styles.figLabel}> · {b.machineTag}</span>}
            </span>
          ))}
        </p>
        <div className={styles.segRow} role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? styles.segOn : styles.seg} onClick={() => pickView("list")}>
            List
          </button>
          <button type="button" role="tab" aria-selected={view === "chart"} className={view === "chart" ? styles.segOn : styles.seg} onClick={() => pickView("chart")}>
            Chart
          </button>
          {/* The sort chip — the current order is never implicit. */}
          <button
            type="button"
            className={styles.sortChip}
            onClick={() => pickSort(rowSort === "date" ? "value" : "date")}
            title="Change the session order"
          >
            {rowSort === "date" ? "by date ↓" : isRepsExercise ? "by reps" : "by load"}
          </button>
        </div>
      </header>

      {view === "list" ? (
        sessionList
      ) : (
        <div className={styles.chartCol}>
          {/* Combine card — once per undecided pair, or reopened prefilled. */}
          {(cardPair ? [cardPair] : undecidedPairs).map((p) => (
            <div key={`${p.a}|${p.b}`} className={styles.suggestCard}>
              <p className={styles.combineTitle}>Combine these machines?</p>
              <p className={styles.suggestBasis}>
                {p.specBasis ??
                  (p.situation === "differ"
                    ? `${p.aLabel} and ${p.bLabel} record different setups — combine only if you know they read the same.`
                    : `${p.aLabel} and ${p.bLabel} — not enough recorded specs to compare them; you know the machines, we don't.`)}
              </p>
              {/* The factor row when scaled mode is open — but every OTHER
                  exit stays visible beneath it: switching mode, editing the
                  factor, or separating are each ONE tap from any state. */}
              {cardMode === "scaled" && cardPair?.a === p.a && cardPair?.b === p.b && (
                <div className={styles.factorRow}>
                  <span className={styles.figLabel}>{labelFor(p, p.estimated)} reads ×</span>
                  <NumberInput value={cardFactor} onChange={setCardFactor} maxIntDigits={2} className={styles.factorInput} ariaLabel="Scale factor" />
                  <span className={styles.figLabel}>against {labelFor(p, p.anchor)}</span>
                  <button
                    type="button"
                    className={styles.combineBtn}
                    onClick={() => {
                      const f = Number(cardFactor);
                      if (Number.isFinite(f) && f > 0) void writeDecision(p, "ratio_estimate", "confirmed", f);
                    }}
                  >
                    Save
                  </button>
                </div>
              )}
              <div className={styles.suggestActions}>
                <button type="button" onClick={() => void writeDecision(p, "same_setup", "confirmed")}>Same setup</button>
                {!(cardMode === "scaled" && cardPair?.a === p.a && cardPair?.b === p.b) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCardPair(p);
                      setCardMode("scaled");
                    }}
                  >
                    Scaled estimate…
                  </button>
                )}
                <button type="button" onClick={() => void writeDecision(p, p.decision?.kind ?? "same_setup", "rejected")}>Keep separate</button>
              </div>
            </div>
          ))}

          {/* Confirmed pairs → one chart each (merged or estimated). */}
          {confirmed.map((p) => {
            const laneA = data.chart.find((c) => c.lane === (p.decision!.kind === "ratio_estimate" ? p.anchor : p.a));
            const laneB = data.chart.find((c) => c.lane === (p.decision!.kind === "ratio_estimate" ? p.estimated : p.b));
            if (!laneA || !laneB) return null;
            const est = p.decision!.kind === "ratio_estimate";
            return (
              <section key={`${p.a}|${p.b}`} className={styles.chartSection}>
                <h2 className={styles.chartTitle}>
                  {laneA.machineTag} + {laneB.machineTag}
                </h2>
                {est && (
                  <p className={styles.chartLegend}>
                    {laneB.machineTag} · ×{p.decision!.factor} · your assumption
                  </p>
                )}
                <StatsChart
                  points={laneA.points}
                  mode={laneA.laneMode}
                  w={w}
                  unit={wUnit}
                  secondary={{ lane: laneB.lane, points: laneB.points }}
                  secondaryStyle={est ? "estimated" : "merged"}
                  factor={p.decision!.factor}
                  onPointTap={tapPoint}
                />
                <p className={styles.chartFoot}>
                  {est
                    ? `Estimated — ${laneB.machineTag} ×${p.decision!.factor} is your assumption, not a measurement; estimated points never count as PRs. Filling both machines' specs suggests a basis; measured overlap can fit the factor later.`
                    : "Combined — you marked these machines as the same setup"}
                  <button type="button" className={styles.decisionFlip} onClick={() => openCard(p)}>
                    change
                  </button>
                </p>
              </section>
            );
          })}

          {/* Undecided / rejected lanes render per machine. */}
          {soloCharts
            .filter((c) => c.points.length >= 2)
            .map((c) => (
              <section key={c.lane} className={styles.chartSection}>
                <h2 className={styles.chartTitle}>
                  {c.machineTag === "unspecified" ? <span className={`${styles.mTag} ${styles.mTagUnspec}`}>unspecified</span> : c.machineTag}
                </h2>
                <StatsChart points={c.points} mode={c.laneMode} w={w} unit={wUnit} onPointTap={tapPoint} />
              </section>
            ))}

          {soloCharts.some((c) => c.points.length < 2) && (
            <p className={styles.note}>charts appear after 2 sessions on a machine</p>
          )}

          {/* A rejected pair keeps a quiet way back in. */}
          {rejectedPairs.length > 0 && cardPair == null && (
            <button type="button" className={styles.combineLink} onClick={() => openCard(rejectedPairs[0])}>
              Combine machines…
            </button>
          )}

          {/* Chart view carries the full list beneath — one screen, both reads. */}
          {sessionList}
        </div>
      )}
    </main>
  );
}
