"use client";

import styles from "./session.module.css";

// The unit indicator on a weight/distance input. READ-ONLY.
//
// It says which unit is in play and why — never offers to change it. The two
// units have different owners and only one of them is a preference at all:
//
//   pinned         a MARKED machine governs this input. A fact about the
//                  machine; muted. Tapping it must not imply you can change
//                  what the stack is stamped in.
//   non-canonical  the display preference governs AND is not lb/mi. A MODE
//                  you're in, and missing it is how the original 264.55 slip
//                  happened — so it is loud.
//   canonical      the ordinary quiet case; nothing to notice.
//
// Changing the preference is a deliberate trip to Settings. It used to be a tap
// here, which gave a global setting the blast radius of a local control: one
// tap mid-session silently re-interpreted every number typed afterwards.
export function EntryUnitLabel({
  unit,
  canonicalUnit,
  pinned = false,
  label,
}: {
  unit: string;
  canonicalUnit: string;
  /** A marked machine governs this input — render as a fact, not a mode. */
  pinned?: boolean;
  /** Optional prefix, e.g. "added" for bodyweight loads. */
  label?: string;
}) {
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

  if (unit !== canonicalUnit) {
    return (
      <span
        className={styles.unitToggleLoud}
        title={`You're entering in ${unit}. Machines you've marked ignore this; it governs portable exercises, unmarked units, and distance. Storage stays ${canonicalUnit}. Change it in Settings.`}
      >
        {text}
        <span className={styles.unitLoudDot} aria-hidden="true" />
      </span>
    );
  }

  return <span className={styles.unitQuiet}>{text}</span>;
}
