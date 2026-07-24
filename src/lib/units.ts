// Entry-side unit conversion (Phase 2 polish §7). Canonical storage is
// INVIOLABLE: everything stores and displays lb / mi / min. These helpers only
// convert what the user TYPES in an alternate unit into the canonical value —
// the shown converted number is exactly what stores.
//
// ENTRY ROUNDING — rounded in the UNIT OF ENTRY, then converted exactly.
// (Before: kg entry was converted first and snapped to the 0.5-lb grid, which
// quantized kg to the wrong grid — 50 kg → 110.231 → 110.0 → read back 49.9.
// The 0.5-lb snap is a plate-math affordance for LB entry only.)
//   lb entry → stored as typed (unchanged: typed lb was never snapped — the
//               0.5 grid only ever applied to the kg→lb conversion, the bug)
//   kg entry → nearest 0.1 kg, then × LB_PER_KG stored to 2 dp lb
//   mi entry → 2 dp (unchanged)
//   km entry → nearest 0.01 km, then × MI_PER_KM stored to 4 dp mi
// The canonical precision (2 dp lb / 4 dp mi) is chosen so the entry unit's
// display rounding (kg 1 dp, km 2 dp) reproduces exactly what was typed.
export const LB_PER_KG = 2.2046226218;
export const MI_PER_KM = 0.6213711922;

/** kg the user typed → canonical lb. Rounds in kg (0.1), converts exactly,
 * keeps 2 dp of lb so a kg round-trip is lossless at display precision. */
export function kgToLb(kg: number): number {
  const inEntryUnit = Math.round(kg * 10) / 10;
  return Math.round(inEntryUnit * LB_PER_KG * 100) / 100;
}

/** km the user typed → canonical mi. Rounds in km (0.01), converts exactly,
 * keeps 4 dp of mi so a km round-trip is lossless at display precision. */
export function kmToMi(km: number): number {
  const inEntryUnit = Math.round(km * 100) / 100;
  return Math.round(inEntryUnit * MI_PER_KM * 10000) / 10000;
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

// ── The universal unit-input contract (§3): canonical (lb/mi) is the ONLY
// source of truth; display = formatForUnit(canonical); ONLY typing writes a
// new canonical via parseInUnit. Switching units re-FORMATS the display from
// canonical — it never re-parses the rounded display back into storage, so
// drift is impossible by construction.
export type UnitDimension = "weight" | "distance";

/** Canonical value (string form, "" = empty) → the text an input displays in
 * the active unit. Display rounding: kg 1 dp, km 2 dp, lb/mi 2 dp. */
export function formatForUnit(canonical: string, unit: string, dim: UnitDimension): string {
  if (canonical.trim() === "") return "";
  const n = Number(canonical);
  if (!Number.isFinite(n)) return "";
  if (dim === "weight") return unit === "kg" ? String(lbToKg(n)) : String(displayLb(n));
  return unit === "km" ? String(miToKm(n)) : String(displayMi(n));
}

/** Canonical lb shown in lb: 2 dp max (canonical carries 2 dp after a kg
 * entry), trailing zeros trimmed by String(). Cosmetic — never stored. */
export function displayLb(lb: number): number {
  return Math.round(lb * 100) / 100;
}

/** Canonical mi shown in mi: 2 dp max (canonical carries 4 dp after a km
 * entry, which would read as "3.1069 mi"). Cosmetic — never stored. */
export function displayMi(mi: number): number {
  return Math.round(mi * 100) / 100;
}

/** Typed text in the active unit → the canonical value to store (string form,
 * "" = empty). Entry rounding happens in the UNIT OF ENTRY (see the header):
 * kg → 0.1 kg, km → 0.01 km; lb/mi are already canonical and pass through. */
export function parseInUnit(text: string, unit: string, dim: UnitDimension): string {
  if (text.trim() === "") return "";
  const n = Number(text);
  if (!Number.isFinite(n)) return "";
  if (dim === "weight") return unit === "kg" ? String(kgToLb(n)) : text;
  return unit === "km" ? String(kmToMi(n)) : text;
}

/** Display a stored single-or-range value in the active unit ("3–4 mi" →
 * "4.83–6.44 km"). Read-side only. */
export function formatStoredDistance(stored: unknown, unit: string): string | null {
  const conv = (n: number) => (unit === "km" ? miToKm(n) : displayMi(n));
  const u = unit === "km" ? "km" : "mi";
  if (Array.isArray(stored) && stored.length === 2) return `${conv(Number(stored[0]))}–${conv(Number(stored[1]))} ${u}`;
  if (typeof stored === "number") return `${conv(stored)} ${u}`;
  return null;
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
