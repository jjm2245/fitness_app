// Single source of truth for which fields a cardio exercise logs / prescribes.
// The session card, the program-editor target sheet, and the editor's target
// chip all read THIS — so an exercise shows the same fields everywhere. It's a
// per-exercise mapping keyed on the name (no per-machine table exists yet); if a
// stored/curated field-set ever lands, this is the one place to swap the source.
export type CardioField = "duration" | "speed" | "incline" | "level" | "distance";

export function cardioFields(name: string): CardioField[] {
  const n = name.toLowerCase();
  if (n.includes("treadmill") || n.includes("incline walk") || n.includes("run")) {
    return ["duration", "speed", "incline"];
  }
  if (n.includes("stair") || n.includes("step")) return ["duration", "level"];
  if (n.includes("bike") || n.includes("cycl") || n.includes("spin")) return ["duration", "level", "distance"];
  if (n.includes("row")) return ["duration", "distance", "level"];
  return ["duration", "distance"];
}

// The jsonb params key each field is stored under (on exercises.params for a
// target, and the cardio_logs column of the same name for an actual). Duration
// is the odd one out (`duration_min`); the rest are stored under their own name.
export const CARDIO_FIELD_KEY: Record<CardioField, string> = {
  duration: "duration_min",
  speed: "speed",
  incline: "incline",
  level: "level",
  distance: "distance",
};

// Short lowercase labels for input cells (session card + target sheet).
export const CARDIO_FIELD_LABEL: Record<CardioField, string> = {
  duration: "min",
  speed: "speed",
  incline: "incline",
  level: "level",
  distance: "distance",
};
