// The ONE resolver for which fields an exercise logs (and targets) — Phase 1
// of the field-config model. Precedence:
//   1. override — exercises.log_fields (a JSON array of field names; NULL or
//      invalid/empty = no override, inherit)
//   2. name-default — cardioFields(name) for cardio-typed exercises (the
//      name-guess heuristic, now a default-provider called only from here;
//      its own duration+distance fallback IS the cardio type-default)
//   3. type-default — strength → weight/reps/effort
// Every surface (CardioCard, TargetSheet, editor chips, AddSheet reference,
// the Fields editor) resolves through this module, so the guess and the
// override can never disagree across surfaces. `src/core/*` never reads this —
// the core's set_logs-only invariant is the progression guard.
import { cardioFields, type CardioField } from "./cardioFields";

export type LogField =
  | "weight"
  | "reps"
  | "effort"
  | "duration"
  | "distance"
  | "level"
  | "speed"
  | "incline";

export const ALL_LOG_FIELDS: LogField[] = [
  "weight",
  "reps",
  "effort",
  "duration",
  "distance",
  "level",
  "speed",
  "incline",
];

// The metric (cardio-style) subset, in the canonical render order the session
// card and target sheet use.
const METRIC_ORDER: CardioField[] = ["duration", "speed", "incline", "level", "distance"];

export interface LogFieldSource {
  // Display name (the resolver's name-default keys off it, same as before).
  name: string;
  conditioningOnly: boolean;
  // Raw jsonb from exercises.log_fields — unknown shape until sanitized.
  logFields?: unknown;
}

/** Sanitize a raw log_fields value: only known field names, deduped, in
 * canonical vocabulary order. Returns null when there is no usable override
 * (null / not an array / empty after sanitizing) — i.e. inherit defaults. */
export function sanitizeOverride(raw: unknown): LogField[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set(raw.filter((f): f is LogField => typeof f === "string" && (ALL_LOG_FIELDS as string[]).includes(f)));
  if (set.size === 0) return null;
  return ALL_LOG_FIELDS.filter((f) => set.has(f));
}

// ── Profiles (Phase 2) ── the six named field sets the editor's picker offers.
// No Custom option: a stored override that matches none renders as the honest
// read-only "Custom config" state until the user picks a profile or Resets.
export interface LogFieldProfile {
  id: string;
  label: string;
  fields: LogField[];
}

export const LOG_FIELD_PROFILES: LogFieldProfile[] = [
  { id: "strength", label: "Strength", fields: ["weight", "reps", "effort"] },
  { id: "cardio_machine", label: "Cardio machine", fields: ["duration", "distance", "level"] },
  { id: "treadmill", label: "Treadmill-style", fields: ["duration", "distance", "speed", "incline"] },
  { id: "distance_cardio", label: "Distance cardio", fields: ["duration", "distance"] },
  { id: "loaded_carry", label: "Loaded carry", fields: ["weight", "duration", "distance", "effort"] },
  { id: "timed_hold", label: "Timed hold", fields: ["weight", "duration"] },
];

// Display units for the picker's fields line and the session cells. Unitless
// fields (reps/effort/level/speed/incline) render bare.
export const FIELD_UNITS: Partial<Record<LogField, string>> = {
  weight: "lb",
  duration: "min",
  distance: "mi",
};

/** The default field set for an exercise, ignoring any override — what a NULL
 * log_fields inherits (used for the "(default)" highlight + Reset).
 *
 * Phase 2: the cardio name-guess maps onto the NEAREST profile so defaults and
 * profiles speak the same sets (a resolver-layer mapping — no rows written):
 *   treadmill/run guess (has speed/incline)      → Treadmill-style
 *   stair/bike/row guess (has level)             → Cardio machine
 *   everything else (duration+distance fallback) → Distance cardio
 * Net visible diff vs the raw guess: duration+level machines gain a
 * blank-optional distance cell; treadmills gain distance. */
export function defaultLogFields(ex: Pick<LogFieldSource, "name" | "conditioningOnly">): LogField[] {
  if (!ex.conditioningOnly) return profileById("strength").fields;
  const guess = cardioFields(ex.name);
  if (guess.includes("speed") || guess.includes("incline")) return profileById("treadmill").fields;
  if (guess.includes("level")) return profileById("cardio_machine").fields;
  return profileById("distance_cardio").fields;
}

function profileById(id: string): LogFieldProfile {
  return LOG_FIELD_PROFILES.find((p) => p.id === id)!;
}

/** THE card/branch router (Phase 2): reps in the resolved set → the strength
 * card + set_logs; otherwise the metric card + cardio_logs. `conditioning_only`
 * no longer routes anything — it only seeds the default field set above. */
export function routesToStrength(ex: LogFieldSource): boolean {
  return resolveLogFields(ex).includes("reps");
}

/** The profile a field set IS (set equality), or null (custom config). */
export function matchProfile(fields: LogField[]): LogFieldProfile | null {
  const set = new Set(fields);
  return (
    LOG_FIELD_PROFILES.find((p) => p.fields.length === set.size && p.fields.every((f) => set.has(f))) ?? null
  );
}

/** The nearest profile to a non-matching set (min symmetric difference; ties →
 * first in the list) — feeds the honest "Custom config — closest: X (±N)". */
export function closestProfile(fields: LogField[]): { profile: LogFieldProfile; diff: number } {
  const set = new Set(fields);
  let best = LOG_FIELD_PROFILES[0];
  let bestDiff = Infinity;
  for (const p of LOG_FIELD_PROFILES) {
    const pset = new Set(p.fields);
    let diff = 0;
    for (const f of set) if (!pset.has(f)) diff++;
    for (const f of pset) if (!set.has(f)) diff++;
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return { profile: best, diff: bestDiff };
}

/** The metric card's cell order: weight first, then the metrics in render
 * order, then effort last (reps never appears here — reps routes strength). */
export function resolveCardFields(ex: LogFieldSource): LogField[] {
  const fields = new Set(resolveLogFields(ex));
  const out: LogField[] = [];
  if (fields.has("weight")) out.push("weight");
  for (const f of METRIC_ORDER) if (fields.has(f)) out.push(f);
  if (fields.has("effort")) out.push("effort");
  return out;
}

/** The resolved field set: override → name-default → type-default. */
export function resolveLogFields(ex: LogFieldSource): LogField[] {
  return sanitizeOverride(ex.logFields) ?? defaultLogFields(ex);
}

/** The metric subset of the resolved fields, in render order — what the cardio
 * session card / cardio target form / target chips actually display. */
export function resolveMetricFields(ex: LogFieldSource): CardioField[] {
  const fields = new Set(resolveLogFields(ex));
  return METRIC_ORDER.filter((f) => fields.has(f));
}

/** True when the exercise carries a usable override (log_fields set). */
export function hasFieldOverride(ex: Pick<LogFieldSource, "logFields">): boolean {
  return sanitizeOverride(ex.logFields) !== null;
}
