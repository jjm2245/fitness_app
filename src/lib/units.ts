// Entry-side unit conversion (Phase 2 polish §7). Canonical storage is
// INVIOLABLE: everything stores and displays lb / mi / min. These helpers only
// convert what the user TYPES in an alternate unit into the canonical value —
// the shown converted number is exactly what stores.
//
// Rounding rule (stated once, applied everywhere):
//   weight   → nearest 0.5 lb   (plate-math granularity)
//   distance → 2 decimals (mi)
export const LB_PER_KG = 2.2046226218;
export const MI_PER_KM = 0.6213711922;

/** kg the user typed → canonical lb, nearest 0.5. */
export function kgToLb(kg: number): number {
  return Math.round(kg * LB_PER_KG * 2) / 2;
}

/** km the user typed → canonical mi, 2 decimals. */
export function kmToMi(km: number): number {
  return Math.round(km * MI_PER_KM * 100) / 100;
}

/** The per-field entry-unit preference (local, entry-side only). */
export type WeightEntryUnit = "lb" | "kg";
export type DistanceEntryUnit = "mi" | "km";

const KEYS = { weight: "entry-unit-weight", distance: "entry-unit-distance" } as const;

export function getEntryUnit(field: "weight"): WeightEntryUnit;
export function getEntryUnit(field: "distance"): DistanceEntryUnit;
export function getEntryUnit(field: "weight" | "distance"): string {
  if (typeof window === "undefined") return field === "weight" ? "lb" : "mi";
  const v = window.localStorage.getItem(KEYS[field]);
  if (field === "weight") return v === "kg" ? "kg" : "lb";
  return v === "km" ? "km" : "mi";
}

export function setEntryUnit(field: "weight" | "distance", unit: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEYS[field], unit);
}
