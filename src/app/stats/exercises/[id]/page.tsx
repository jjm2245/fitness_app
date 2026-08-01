"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "../../stats.module.css";
import { deltaText, type Delta, type LaneMode } from "@/lib/statsShape";
import { useWeightUnit } from "@/lib/useUnit";
import { displayLb, lbToKg } from "@/lib/units";

// /stats/exercises/[id] — one exercise's full history.
//
// List = one combined chronological stream (sessions grouped by
// workout_logs.id server-side — two sessions on one date stay two rows).
// Chart = per-machine sections, inline SVG, no chart library. A machine with
// exactly one session keeps its list row inside Chart view — no one-dot charts.
//
// Comparability rendering effects (shared-axis merge, dashed ratio estimate)
// are G4-SKIPPED this round: no spec-identical pair and no differing-ratio
// plain-cable pair exists in the data, so sections stay separate regardless of
// decisions. The suggestion card and decision line below are data-driven and
// simply never render until a qualifying pair exists.

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
  tonnage: number;
  delta: Delta;
  deltaHasUnit: boolean;
  isPr: boolean;
}

interface Payload {
  exerciseId: string;
  name: string;
  sessionCount: number;
  machineCount: number;
  dateRange: { from: string; to: string };
  bests: Array<{ lane: string; machineTag: string; laneMode: LaneMode; load?: number; reps?: number; date: string }>;
  sessions: SessionRow[];
  chart: Array<{
    lane: string;
    machineTag: string;
    laneMode: LaneMode;
    points: Array<{ workoutLogId: number; date: string; value: number; reps: number; isPr: boolean }>;
  }>;
  comparability: {
    suggestions: Array<{ kind: string; a: string; b: string; aLabel: string; bLabel: string; basis: string }>;
    decisions: Array<{ id: number; a: string; b: string; kind: string; status: string; basis: string }>;
  };
}

const VIEW_KEY = "fitness-app:stats-view";

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ExerciseStatsPage() {
  const params = useParams<{ id: string }>();
  const exerciseId = decodeURIComponent(params.id);
  const [data, setData] = useState<Payload | null>(null);
  const [missing, setMissing] = useState(false);
  // SSR-safe view-mode adoption — default first, stored value in an effect
  // (the useUnit hydration rule).
  const [view, setView] = useState<"list" | "chart">("list");
  useEffect(() => {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === "chart") setView("chart");
  }, []);
  function pickView(v: "list" | "chart") {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode — the segment still switches for this visit */
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

  async function decide(s: { a: string; b: string; kind: string; basis: string }, status: "confirmed" | "rejected") {
    await fetch("/api/stats/comparability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...s, status }),
    });
    await refresh();
  }

  if (missing) {
    return (
      <main className={styles.page}>
        <p className={styles.note}>No history for this exercise yet.</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className={styles.page}>
        <p className={styles.note}>Loading…</p>
      </main>
    );
  }

  const singlePointLanes = new Set(data.chart.filter((c) => c.points.length < 2).map((c) => c.lane));

  return (
    <main className={styles.page}>
      <header className={styles.exHeader}>
        <h1 className={styles.title}>{data.name}</h1>
        <p className={styles.exHeaderSub}>
          {data.sessionCount} {data.sessionCount === 1 ? "session" : "sessions"} · {data.machineCount}{" "}
          {data.machineCount === 1 ? "machine" : "machines"} · {shortDay(data.dateRange.from)} –{" "}
          {shortDay(data.dateRange.to)}
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
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? styles.segOn : styles.seg}
            onClick={() => pickView("list")}
          >
            List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "chart"}
            className={view === "chart" ? styles.segOn : styles.seg}
            onClick={() => pickView("chart")}
          >
            Chart
          </button>
        </div>
      </header>

      {view === "list" ? (
        <ul className={styles.sessList}>
          {data.sessions.map((s) => (
            <SessionLine key={`${s.workoutLogId}-${s.lane}`} s={s} w={w} unit={wUnit} />
          ))}
        </ul>
      ) : (
        <div className={styles.chartCol}>
          {/* Undecided suggestion among these machines → the quiet card. */}
          {data.comparability.suggestions.map((s) => (
            <div key={`${s.a}|${s.b}|${s.kind}`} className={styles.suggestCard}>
              <p className={styles.suggestBasis}>{s.basis}</p>
              <div className={styles.suggestActions}>
                <button type="button" onClick={() => decide(s, "confirmed")}>Combine</button>
                <button type="button" onClick={() => decide(s, "rejected")}>Keep separate</button>
              </div>
            </div>
          ))}
          {/* Decided pairs: current state, one tap to flip — both directions. */}
          {data.comparability.decisions.map((d) => (
            <p key={d.id} className={styles.decisionLine}>
              {d.status === "confirmed" ? "combined" : "kept separate"} ·{" "}
              {d.kind === "same_setup" ? "same setup" : "ratio estimate"}
              <button
                type="button"
                className={styles.decisionFlip}
                onClick={() => decide(d, d.status === "confirmed" ? "rejected" : "confirmed")}
              >
                {d.status === "confirmed" ? "keep separate instead" : "combine instead"}
              </button>
            </p>
          ))}

          {data.chart
            .filter((c) => c.points.length >= 2)
            .map((c) => (
              <section key={c.lane} className={styles.chartSection}>
                <h2 className={styles.chartTitle}>
                  {c.machineTag === "unspecified" ? (
                    <span className={`${styles.mTag} ${styles.mTagUnspec}`}>unspecified</span>
                  ) : (
                    c.machineTag
                  )}
                </h2>
                <LaneChart points={c.points} mode={c.laneMode} w={w} unit={wUnit} />
              </section>
            ))}

          {/* A machine with one session keeps its LIST row here — no one-dot charts. */}
          {data.sessions
            .filter((s) => singlePointLanes.has(s.lane))
            .map((s) => (
              <ul key={`single-${s.workoutLogId}-${s.lane}`} className={styles.sessList}>
                <SessionLine s={s} w={w} unit={wUnit} />
              </ul>
            ))}
        </div>
      )}
    </main>
  );
}

function SessionLine({ s, w, unit }: { s: SessionRow; w: (lb: number) => string | number; unit: string }) {
  return (
    <li className={styles.sessRow}>
      <div className={styles.sessTop}>
        <span className={styles.sessFigure}>
          {s.laneMode === "reps"
            ? s.repsList && s.repsList.length > 0
              ? `${s.repsList.join(", ")} reps`
              : "—"
            : s.figure
            ? `${w(s.figure.load)} ${unit} × ${s.figure.reps}`
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
        {s.machineTagKind === "unspecified" ? (
          <span className={styles.mTagUnspec}>unspecified</span>
        ) : (
          s.machineTag
        )}
        <span className={styles.metaDot}> · </span>
        {s.setsCount} {s.setsCount === 1 ? "set" : "sets"}
        {s.laneMode === "loaded" && (
          <>
            <span className={styles.metaDot}> · </span>
            {w(s.tonnage)} {unit}
          </>
        )}
      </div>
      <div className={s.delta.tier === "bright" ? styles.tierBright : styles.tierQuiet}>
        {deltaText(s.delta, w, unit, s.deltaHasUnit)}
      </div>
    </li>
  );
}

// Inline SVG — top-working-set line for a single machine. No chart library.
// Point and axis labels are MONO (isolated numeric values); everything else on
// this screen that mixes numbers into phrases stays in the UI face.
function LaneChart({
  points,
  mode,
  w,
  unit,
}: {
  points: Array<{ date: string; value: number; reps: number; isPr: boolean }>;
  mode: LaneMode;
  w: (lb: number) => string | number;
  unit: string;
}) {
  const W = 340;
  const H = 130;
  const PAD_LEFT = 30;
  const PAD_RIGHT = 16;
  const PAD_TOP = 26;
  const PAD_BOTTOM = 30;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => PAD_LEFT + (i * (W - PAD_LEFT - PAD_RIGHT)) / (points.length - 1);
  const y = (v: number) => PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) * (1 - (v - min) / span);
  const fmt = (v: number) => (mode === "loaded" ? `${w(v)}` : `${v}`);
  const axisUnit = mode === "loaded" ? unit : "reps";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Top working set per session">
      {/* axis endpoints — min and max, mono */}
      <text x={2} y={y(max) + 3} className={styles.chartAxis}>{fmt(max)}</text>
      <text x={2} y={y(min) + 3} className={styles.chartAxis}>{fmt(min)}</text>
      <text x={2} y={H - 4} className={styles.chartAxisUnit}>{axisUnit}</text>
      <polyline
        fill="none"
        className={styles.chartLine}
        points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
      />
      {points.map((p, i) => (
        <g key={`${p.date}-${i}`}>
          <circle cx={x(i)} cy={y(p.value)} r={p.isPr ? 4 : 2.6} className={p.isPr ? styles.chartDotPr : styles.chartDot} />
          <text x={x(i)} y={y(p.value) - 8} textAnchor="middle" className={styles.chartPointLabel}>
            {mode === "loaded" ? `${w(p.value)}×${p.reps}` : `${p.value}`}
          </text>
          <text x={x(i)} y={H - 16} textAnchor="middle" className={styles.chartDate}>
            {shortDay(p.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}
