"use client";

import sheetStyles from "./Sheet.module.css";
import styles from "./session.module.css";
import { Sheet } from "./Sheet";
import { EQUIPMENT_TYPE_BY_ID, suggestEquipmentType } from "@/lib/equipment";
import type { SubstitutionCandidate } from "./shared";

// The swap sheet (phase 2, Part 2): the same deterministic /api/substitutions
// candidates (already ranked; first = best match), translated into lifter
// language. The equipment sub-line surfaces the offset a pick would suggest
// BEFORE you pick, so the offset confirm chip on the card is never a surprise.
// No LLM anywhere near this.

// Plain-English equipment line from the same registry the card uses: the
// suggested equipment type's human label + its default built-in weight.
function equipmentLine(c: SubstitutionCandidate): string {
  const type = suggestEquipmentType(c.loadType, c.name);
  const def = EQUIPMENT_TYPE_BY_ID.get(type);
  if (!def) return c.loadType.replace(/_/g, " ");
  const label =
    c.loadType === "free_weight" && !def.instanceMatters && def.defaultOffset === 0
      ? "free weight"
      : def.label.toLowerCase();
  if (def.defaultOffset != null && def.defaultOffset !== 0) return `${label} · +${def.defaultOffset} built-in`;
  if (def.defaultOffset == null) return `${label} · built-in varies`;
  return label;
}

export function SwapSheet({
  originalName,
  candidates,
  onPick,
  onClose,
}: {
  originalName: string;
  candidates: SubstitutionCandidate[] | null;
  onPick: (c: SubstitutionCandidate) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={`Swap ${originalName}`}
      subtitle="Same muscles, works with your equipment. Your weekly volume is preserved."
      footer="Swaps apply to today only — your program is unchanged. Undo anytime from the card menu."
      onClose={onClose}
    >
      {candidates == null ? (
        <p className={sheetStyles.subtitle}>Finding swaps…</p>
      ) : candidates.length === 0 ? (
        <p className={sheetStyles.subtitle}>No swaps available for this exercise.</p>
      ) : (
        candidates.map((c, i) => (
          <button key={c.id} type="button" className={styles.swapRow} onClick={() => onPick(c)}>
            <span className={styles.swapRowMain}>
              <span className={styles.swapRowName}>{c.name}</span>
              <span className={styles.swapRowSub}>{equipmentLine(c)}</span>
            </span>
            {i === 0 && <span className={styles.swapBest}>best match</span>}
          </button>
        ))
      )}
    </Sheet>
  );
}
