// The target's effort model. A program-exercise target adopts the SAME 3-level
// scale the session logs (the `effort` enum), so a target is directly comparable
// to actuals — but the target-context label for the easiest level is "Relaxed"
// (the session calls it "More in me"). The stored values are identical.
//
// STORAGE NOTE (interim): until the additive `effort_target` column lands, the
// target's effort rides on the legacy numeric `rir_target` via the bucket below
// — the SAME buckets the migration backfill uses, so the interim writes convert
// losslessly when the column is added. Once `effort_target` exists, the sheet
// reads/writes the enum directly and these rir<->tag shims retire.
import type { EffortTag } from "./effort";

export type { EffortTag } from "./effort";

// Pills, in ascending intensity. Value = the session enum; label = target voice.
export const TARGET_EFFORT_OPTIONS: { value: EffortTag; label: string }[] = [
  { value: "more_in_me", label: "Relaxed" },
  { value: "near_failure", label: "Near failure" },
  { value: "to_failure", label: "To failure" },
];

// Compact chip / target-line label (lowercase — reads inline, e.g. "· relaxed").
export const TARGET_EFFORT_LABEL: Record<EffortTag, string> = {
  more_in_me: "relaxed",
  near_failure: "near failure",
  to_failure: "to failure",
};

// Legacy `rir_target` → tag, bucketed to match the migration backfill exactly
// (0–1 → to failure, 2–3 → near failure, 4+ → relaxed, null → none).
export function rirToEffortTag(rir: string | number | null | undefined): EffortTag | null {
  if (rir === null || rir === undefined || rir === "") return null;
  const n = Number(rir);
  if (Number.isNaN(n)) return null;
  if (n <= 1) return "to_failure";
  if (n <= 3) return "near_failure";
  return "more_in_me";
}

// A tag → representative `rir_target` string that re-buckets to the same tag
// (to failure → "0", near failure → "2", relaxed → "4"). Used only when the tag
// actually changes; a no-edit save preserves the original string instead.
const TAG_TO_RIR: Record<EffortTag, string> = {
  to_failure: "0",
  near_failure: "2",
  more_in_me: "4",
};

// `rir_target` is a PROJECTION of the authoritative `effort_target` tag, kept in
// sync on save so the progression engine (which reads the number) stays
// consistent — and never hand-edited. If the tag is unchanged from what the row
// opened with, keep the ORIGINAL number byte-identically (a no-edit save is a
// no-op, and existing rows never silently shift progression on deploy); only a
// changed tag writes its representative.
export function rirForEffortTarget(tag: EffortTag | null, initialTag: EffortTag | null, originalRir: string | null): string | null {
  if (tag === initialTag) return originalRir;
  return tag === null ? null : TAG_TO_RIR[tag];
}
