// Single-or-range target values (Phase 2 polish §5). Duration pioneered the
// stored representation — a plain number or a `[min, max]` pair in
import { formatStoredDistance } from "./units";

// exercises.params — and distance now shares it. These helpers are the ONE
// parse/store/format path so both fields round-trip byte-identically
// (Stairmaster's `[5,15]` and every existing single value included).

export type RangeMode = "single" | "range";

export interface ParsedRangeValue {
  mode: RangeMode;
  single: string; // "" when unset or when the stored value is a range
  a: string;
  b: string;
}

/** Stored params value → editable strings. Unknown shapes read as unset. */
export function parseRangeValue(stored: unknown): ParsedRangeValue {
  if (Array.isArray(stored) && stored.length === 2) {
    return { mode: "range", single: "", a: String(stored[0]), b: String(stored[1]) };
  }
  if (typeof stored === "number") {
    return { mode: "single", single: String(stored), a: "", b: "" };
  }
  return { mode: "single", single: "", a: "", b: "" };
}

/** Editable strings → the params value to store: a number, a `[min,max]`
 * pair, or undefined (= delete the key). An incomplete range stores nothing —
 * same rule duration has always used. */
export function storeRangeValue(p: ParsedRangeValue): number | [number, number] | undefined {
  if (p.mode === "single") {
    return p.single.trim() === "" ? undefined : Number(p.single);
  }
  if (p.a.trim() !== "" && p.b.trim() !== "") return [Number(p.a), Number(p.b)];
  return undefined;
}

/** True when the value counts as filled (anchor math). */
export function rangeValueComplete(p: ParsedRangeValue): boolean {
  return p.mode === "single" ? p.single.trim() !== "" : p.a.trim() !== "" && p.b.trim() !== "";
}

/** Display: `30 min`, `5–15 min`, `0.5 mi`, `3–4 mi`. Null when unset/unknown. */
export function formatRangeValue(stored: unknown, unit: string): string | null {
  if (Array.isArray(stored) && stored.length === 2) return `${stored[0]}–${stored[1]} ${unit}`;
  if (typeof stored === "number") return `${stored} ${unit}`;
  return null;
}

/** True when a stored value is present in either shape (anchor checks). */
export function hasRangeValue(stored: unknown): boolean {
  return typeof stored === "number" || (Array.isArray(stored) && stored.length === 2);
}

// The ONE metric-target line builder — the parts a metric target renders as
// ("5 min · 0.5 mi · near failure"). Shared by the session card's `target`
// reference, the program/blocks chip, and the Add-picker reference so the
// three can never drift. Distance follows the caller's display unit.
export function metricTargetParts(
  params: Record<string, unknown> | null | undefined,
  fields: readonly string[],
  distUnit: string,
  effortLabels: Record<string, string>
): string[] {
  const p = params ?? {};
  const parts: string[] = [];
  for (const f of fields) {
    if (f === "duration") {
      const t = formatRangeValue(p.duration_min, "min");
      if (t) parts.push(t);
    } else if (f === "level" && typeof p.level === "number") parts.push(`level ${p.level}`);
    else if (f === "speed" && typeof p.speed === "number") parts.push(`${p.speed} speed`);
    else if (f === "incline" && typeof p.incline === "number") parts.push(`${p.incline} incline`);
    else if (f === "distance") {
      const t = formatStoredDistance(p.distance, distUnit);
      if (t) parts.push(t);
    }
  }
  if (typeof p.effort === "string" && p.effort in effortLabels) parts.push(effortLabels[p.effort]);
  return parts;
}

/** True when a metric target is "set" — it needs a duration or a distance. */
export function hasMetricTarget(params: Record<string, unknown> | null | undefined): boolean {
  const p = params ?? {};
  return hasRangeValue(p.duration_min) || hasRangeValue(p.distance);
}
