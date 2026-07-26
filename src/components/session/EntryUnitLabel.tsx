"use client";

import { useState } from "react";
import styles from "./session.module.css";

// The unit label on a weight/distance input — and the one place the global
// preference can be switched from.
//
// Three states, deliberately distinct, because they mean different things:
//
//   pinned      a MARKED machine governs this input. Muted text, not a
//               control: it states a fact about the machine, and tapping it
//               must not imply you can change what the stack is stamped in.
//   non-canonical  the global preference governs AND is not lb/mi. This is a
//               MODE the user is in, and missing it is how the original slip
//               happened — so it is loud (accent + tinted) rather than quiet.
//   canonical   the ordinary quiet toggle.
//
// Switching asks first. Not a blocking modal — an inline row, because this sits
// mid-workout — but a switch that silently re-interprets every number you type
// next is worth one tap of confirmation.
export function EntryUnitLabel({
  unit,
  canonicalUnit,
  pinned = false,
  label,
  onSwitch,
}: {
  unit: string;
  canonicalUnit: string;
  /** A marked machine governs this input — render as a fact, not a control. */
  pinned?: boolean;
  /** Optional prefix, e.g. "added" for bodyweight loads. */
  label?: string;
  /** Perform the switch (toggle the preference and clear the field). */
  onSwitch: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const text = label ? `${label} ${unit}` : unit;

  if (pinned) {
    return (
      <span
        className={styles.unitPinned}
        title={`This machine's weights are marked in ${unit} — the box matches the markings you're reading. Storage stays ${canonicalUnit}.`}
      >
        {text} · marked
      </span>
    );
  }

  const nonCanonical = unit !== canonicalUnit;

  if (confirming) {
    const next = nonCanonical ? canonicalUnit : unit === "lb" ? "kg" : unit === "kg" ? "lb" : unit === "mi" ? "km" : "mi";
    return (
      <span className={styles.unitConfirm}>
        Switch to {next}?
        <button
          type="button"
          className={styles.unitConfirmYes}
          onClick={() => { onSwitch(); setConfirming(false); }}
        >
          Switch
        </button>
        <button type="button" className={styles.unitConfirmNo} onClick={() => setConfirming(false)}>
          Keep {unit}
        </button>
        <span className={styles.unitConfirmNote}>
          Changes what you type and see here. Stored values are always {canonicalUnit} — nothing already logged moves.
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={nonCanonical ? styles.unitToggleLoud : styles.unitToggle}
      onClick={() => setConfirming(true)}
      title={
        nonCanonical
          ? `You're entering in ${unit}. Machines you've marked ignore this; it governs portable exercises, unmarked units, and distance. Storage stays ${canonicalUnit}.`
          : `Switch entry/display unit — storage stays ${canonicalUnit}`
      }
    >
      {text}
      {nonCanonical && <span className={styles.unitLoudDot} aria-hidden="true" />}
    </button>
  );
}
