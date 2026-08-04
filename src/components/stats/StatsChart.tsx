"use client";

import { ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer } from "recharts";
import styles from "./statsChart.module.css";
import { paddedDomain } from "@/lib/statsShape";

// The Stats chart — Recharts under the DESIGN token contract (G2):
// CSS variables only (no hex anywhere in this file — greped), mono tick and
// point labels via our own renderers, accent line over an accent→transparent
// area fill, PR dots in --accent-2 at a larger radius, estimated series dashed
// with open circles and italic `RAW → est N` labels, TIME-TRUE x axis
// (positions proportional to real dates), y domain padded so no point sits on
// the frame. No Recharts default palette, no Recharts <Legend> — legends are
// our own components in the page.
//
// Single-point suppression lives in the PAGE (a one-session machine renders a
// quiet line instead of a chart) — this component assumes ≥2 points on the
// primary series.

export interface ChartPoint {
  workoutLogId: number;
  date: string; // YYYY-MM-DD
  value: number; // canonical lb (or reps on reps lanes)
  reps: number;
  isPr: boolean;
}

interface SeriesPoint extends ChartPoint {
  ts: number;
  est?: boolean;
  rawValue?: number; // pre-factor value, for the `RAW → est N` label
  lane?: string;
}

const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function StatsChart({
  points,
  mode,
  w,
  unit,
  secondary,
  secondaryStyle,
  factor,
  onPointTap,
}: {
  points: ChartPoint[];
  mode: "loaded" | "reps";
  w: (lb: number) => string | number;
  unit: string;
  /** Second machine's points — merged (same_setup) or estimated (ratio). */
  secondary?: { lane: string; points: ChartPoint[] } | null;
  secondaryStyle?: "merged" | "estimated";
  /** Owner-declared ×N — estimated values render value × factor. */
  factor?: number | null;
  onPointTap?: (workoutLogId: number, lane?: string) => void;
}) {
  const primary: SeriesPoint[] = points.map((p) => ({ ...p, ts: ts(p.date) }));
  const second: SeriesPoint[] = (secondary?.points ?? []).map((p) =>
    secondaryStyle === "estimated"
      ? { ...p, ts: ts(p.date), est: true, rawValue: p.value, value: p.value * (factor ?? 1), isPr: false, lane: secondary?.lane }
      : { ...p, ts: ts(p.date), lane: secondary?.lane }
  );

  const all = [...primary, ...second];
  const values = all.map((p) => p.value);
  const [yMin, yMax] = paddedDomain(values);
  const xs = all.map((p) => p.ts);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xPad = Math.max((xMax - xMin) * 0.06, 12 * 3600 * 1000);
  const fmt = (v: number) => (mode === "loaded" ? String(w(v)) : String(Math.round(v)));

  const dot =
    (shape: "circle" | "square", est = false) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => {
      const p: SeriesPoint = props.payload;
      const r = p.isPr ? 4.5 : 3;
      const cls = p.isPr ? styles.dotPr : est ? styles.dotEst : styles.dot;
      const tap = () => onPointTap?.(p.workoutLogId, p.lane);
      if (shape === "square" && !p.isPr) {
        return (
          <rect key={`${p.workoutLogId}-${p.ts}`} x={props.cx - 3} y={props.cy - 3} width={6} height={6} className={cls} onClick={tap} />
        );
      }
      return <circle key={`${p.workoutLogId}-${p.ts}`} cx={props.cx} cy={props.cy} r={r} className={cls} onClick={tap} />;
    };

  // Recharts label callbacks carry index/x/y but NOT payload — each series
  // must resolve labels against ITS OWN points. Indexing `primary` from the
  // estimated line's labels rendered the wrong series' numbers (caught live:
  // "100 → est 100" on a ×2 estimate whose real points were 400/420).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pointLabel = (series: SeriesPoint[], est = false) => (props: any) => {
    const p: SeriesPoint = props.payload ?? series[props.index];
    if (!p) return null;
    const text = est
      ? `${fmt(p.rawValue ?? p.value)} → est ${fmt(p.value)}`
      : mode === "loaded"
      ? `${w(p.value)}×${p.reps}`
      : `${Math.round(p.value)}`;
    return (
      <text x={props.x} y={(props.y ?? 0) - 9} textAnchor="middle" className={est ? styles.labelEst : styles.label}>
        {text}
      </text>
    );
  };

  return (
    <div className={styles.wrap}>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart margin={{ top: 22, right: 14, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="statsAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="ts"
            type="number"
            domain={[xMin - xPad, xMax + xPad]}
            ticks={primary.map((p) => p.ts)}
            tickFormatter={(t: number) =>
              new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
            }
            tick={{ className: styles.tickDate } as never}
            axisLine={false}
            tickLine={false}
            height={18}
          />
          <YAxis
            type="number"
            domain={[yMin, yMax]}
            ticks={[Math.min(...values), Math.max(...values)]}
            tickFormatter={fmt}
            tick={{ className: styles.tick } as never}
            axisLine={false}
            tickLine={false}
            width={34}
          />
          <Area data={primary} dataKey="value" type="linear" stroke="none" fill="url(#statsAreaFill)" isAnimationActive={false} />
          <Line
            data={primary}
            dataKey="value"
            type="linear"
            className={styles.line}
            stroke="var(--accent)"
            strokeWidth={1.7}
            dot={dot("circle")}
            label={pointLabel(primary, false)}
            isAnimationActive={false}
          />
          {secondary && secondaryStyle === "merged" && (
            <Line
              data={second}
              dataKey="value"
              type="linear"
              stroke="var(--accent)"
              strokeWidth={1.7}
              dot={dot("square")}
              label={pointLabel(second, false)}
              isAnimationActive={false}
            />
          )}
          {secondary && secondaryStyle === "estimated" && (
            <Line
              data={second}
              dataKey="value"
              type="linear"
              stroke="var(--text-3)"
              strokeWidth={1.4}
              strokeDasharray="5 4"
              dot={dot("circle", true)}
              label={pointLabel(second, true)}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <span className={styles.axisUnit}>{mode === "loaded" ? unit : "reps"}</span>
    </div>
  );
}
