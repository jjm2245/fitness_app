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
// (to failure → "0", near failure → "2", relaxed → "4"). Used only for the
// interim write; a no-edit save preserves the original string instead (below).
const TAG_TO_RIR: Record<EffortTag, string> = {
  to_failure: "0",
  near_failure: "2",
  more_in_me: "4",
};

// Resolve what to store in `rir_target` given the chosen tag and the value the
// sheet opened with. If the tag is unchanged from what the original rir mapped
// to, write back the ORIGINAL string byte-identically (no silent rewrite);
// otherwise write the representative for the newly chosen tag.
export function effortTagToRirStore(tag: EffortTag | null, originalRir: string | null): string | null {
  if (tag === rirToEffortTag(originalRir)) return originalRir;
  return tag === null ? null : TAG_TO_RIR[tag];
}
