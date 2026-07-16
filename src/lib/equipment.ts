// Equipment type registry (Part 3b) — NOT in src/core (the core only ever sees
// opaque lane strings). Equipment = how resistance is applied to a strength
// set; if it doesn't change how a load is recorded or compared, it isn't
// equipment (belts/straps/chalk = notes; cardio has its own model).
//
// Principle: standardized tools get real default offsets; unit-specific ones
// default to UNKNOWN (null) or a flagged weak typical and get corrected per
// unit. Never invent precision — a wrong offset silently corrupts every set.

export type EquipmentTypeId =
  | "bodyweight"
  | "dumbbell"
  | "kettlebell"
  | "fixed_barbell"
  | "olympic_barbell"
  | "ez_curl_bar"
  | "cable"
  | "selectorized"
  | "smith"
  | "plate_loaded";

export interface EquipmentTypeDef {
  id: EquipmentTypeId;
  label: string;
  // Default additive offset (lb). null = UNKNOWN — prompt per unit, never guess.
  defaultOffset: number | null;
  // Weak default: a plausible typical, flagged so the UI asks for confirmation
  // rather than silently applying it (Smith counterbalances range ~6–25).
  weakDefault?: boolean;
  // Instance identity matters (which unit) — the inverse of "portable".
  instanceMatters: boolean;
  note?: string;
}

export const EQUIPMENT_TYPES: EquipmentTypeDef[] = [
  { id: "bodyweight", label: "Bodyweight", defaultOffset: 0, instanceMatters: false, note: "added weight (vest/belt) goes in the added-weight field" },
  { id: "dumbbell", label: "Dumbbell", defaultOffset: 0, instanceMatters: false, note: "the number is the weight" },
  { id: "kettlebell", label: "Kettlebell", defaultOffset: 0, instanceMatters: false },
  { id: "fixed_barbell", label: "Fixed barbell", defaultOffset: 0, instanceMatters: false, note: "labeled total (pre-loaded bars)" },
  { id: "olympic_barbell", label: "Olympic barbell", defaultOffset: 45, instanceMatters: false, note: "standardized 45 lb" },
  { id: "ez_curl_bar", label: "EZ curl bar", defaultOffset: 20, weakDefault: true, instanceMatters: false, note: "varies 15–30 — confirm" },
  { id: "cable", label: "Cable", defaultOffset: 0, instanceMatters: true, note: "stack number is the selection" },
  { id: "selectorized", label: "Selectorized machine", defaultOffset: 0, instanceMatters: true, note: "stack number is the selection" },
  { id: "smith", label: "Smith machine", defaultOffset: 20, weakDefault: true, instanceMatters: true, note: "counterbalanced units range ~6–25, some 45 — confirm per unit" },
  { id: "plate_loaded", label: "Plate-loaded / leverage", defaultOffset: null, instanceMatters: true, note: "carriage/handle weight is unit-specific (~10–30) — set per unit" },
];

export const EQUIPMENT_TYPE_BY_ID = new Map(EQUIPMENT_TYPES.map((t) => [t.id, t]));

export function isContextBound(type: string | null | undefined): boolean {
  return !!type && (EQUIPMENT_TYPE_BY_ID.get(type as EquipmentTypeId)?.instanceMatters ?? false);
}

// Opaque lane key handed to the deterministic core (which groups by it and
// re-baselines on change — it never learns what the segments mean):
//   named unit        → the unit's id (unchanged from the machine era, so no
//                       existing lane re-baselines from this migration)
//   context-bound,    → "type:unspecified" — a generic unit of that type with
//   no unit named       its OWN lane (NOT portable: Smith loads don't transfer)
//   portable types    → null (the one continuous portable lane)
export function laneKey(equipmentType: string | null | undefined, equipmentId: string | null | undefined): string | null {
  if (equipmentId) return equipmentId;
  if (isContextBound(equipmentType)) return `${equipmentType}:unspecified`;
  return null;
}

// Pre-select an equipment type from the exercise (3f) — a VISIBLE default in an
// always-shown field, never hidden inference. free_weight resolves by name
// keyword; the caller must treat non-zero-offset keyword picks as UNCONFIRMED
// (pre-select the type, but never auto-apply the offset until confirmed once —
// wrong-toward-zero costs nothing, wrong-toward-45 corrupts every set).
export function suggestEquipmentType(loadType: string, exerciseName: string): EquipmentTypeId {
  switch (loadType) {
    case "bodyweight": return "bodyweight";
    case "smith": return "smith";
    case "cable": return "cable";
    case "machine_selectorized": return "selectorized";
    case "plate_loaded": return "plate_loaded";
    default: {
      const n = exerciseName.toLowerCase();
      if (n.includes("kettlebell")) return "kettlebell";
      if (n.includes("ez-bar") || n.includes("ez bar") || n.includes("ez curl")) return "ez_curl_bar";
      if (n.includes("barbell")) return "olympic_barbell";
      return "dumbbell"; // safe fallback: zero offset
    }
  }
}
