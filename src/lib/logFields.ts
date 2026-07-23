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

/** The default field set for an exercise, ignoring any override — what a NULL
 * log_fields inherits (used for the "default for <type> is …" editor line). */
export function defaultLogFields(ex: Pick<LogFieldSource, "name" | "conditioningOnly">): LogField[] {
  if (ex.conditioningOnly) return cardioFields(ex.name) as LogField[];
  return ["weight", "reps", "effort"];
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
