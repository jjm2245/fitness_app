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

// ── Display conversion (read-side, cosmetic — NEVER feeds back into storage).
// Display rounding is stated separately from entry rounding: kg → 1 decimal,
// km → 2 decimals. A display conversion never writes.
export function lbToKg(lb: number): number {
  return Math.round((lb / LB_PER_KG) * 10) / 10;
}

export function miToKm(mi: number): number {
  return Math.round((mi / MI_PER_KM) * 100) / 100;
}

/** Display-transform every "N lb" occurrence in a prose line ("120 lb × 10,
 * 10, 8" → "54.4 kg × 10, 10, 8") — pure string mapping for reference lines
 * built from canonical values. Identity when the unit is lb. */
export function displayWeights(text: string, unit: WeightUnit): string {
  if (unit === "lb") return text;
  return text.replace(/(\d+(?:\.\d+)?) lb/g, (_, n) => `${lbToKg(Number(n))} kg`);
}

/** One GLOBAL preference per dimension (weight, distance) — every surface
 * reads the same key, so added/built-in/reference can never disagree. The
 * choice affects display + entry interpretation only; storage stays lb/mi. */
export type WeightUnit = "lb" | "kg";
export type DistanceUnit = "mi" | "km";
// Back-compat aliases (pre-global naming).
export type WeightEntryUnit = WeightUnit;
export type DistanceEntryUnit = DistanceUnit;

const KEYS = { weight: "entry-unit-weight", distance: "entry-unit-distance" } as const;

type UnitListener = () => void;
const listeners = new Set<UnitListener>();

/** Subscribe to unit-preference changes (so every mounted surface follows a
 * toggle together). Returns the unsubscribe. */
export function subscribeUnits(cb: UnitListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getEntryUnit(field: "weight"): WeightUnit;
export function getEntryUnit(field: "distance"): DistanceUnit;
export function getEntryUnit(field: "weight" | "distance"): string {
  if (typeof window === "undefined") return field === "weight" ? "lb" : "mi";
  const v = window.localStorage.getItem(KEYS[field]);
  if (field === "weight") return v === "kg" ? "kg" : "lb";
  return v === "km" ? "km" : "mi";
}

export function setEntryUnit(field: "weight" | "distance", unit: string): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEYS[field], unit);
  for (const cb of listeners) cb();
}
