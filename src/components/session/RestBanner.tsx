"use client";

import styles from "./session.module.css";
import { fmtRest } from "./shared";

// The live rest timer — the most alive element on the screen while running
// (accent, big mono numerals, gentle pulse; the session bar mirrors it via
// the display-only restTimerBus, which the CARD still publishes). Purely
// presentational: the card owns the state machine (start/stop/target/held →
// next set's restBefore).
export function RestBanner({
  timerStart,
  timerElapsed,
  heldRest,
  onStart,
  onStop,
  onDiscardHeld,
  nextNoun = "set",
}: {
  timerStart: number | null;
  timerElapsed: number;
  heldRest: number | null;
  onStart: () => void;
  onStop: () => void;
  onDiscardHeld: () => void;
  // Both cards store rest now (set_logs / cardio_logs, same shape); only the
  // noun differs. Strength default "set" keeps its copy byte-identical.
  nextNoun?: "set" | "entry";
}) {
  if (heldRest != null) {
    return (
      <div className={styles.timerHeld} title={`Will be recorded automatically as the next ${nextNoun}'s rest (source: timed)`}>
        <span>
          ⏱ rest <span className={styles.timerHeldDigits}>{fmtRest(heldRest)}</span> → written to your next {nextNoun}
        </span>
        <button type="button" onClick={onDiscardHeld} className={styles.chipDismiss} title="Discard this timed rest" aria-label="Discard timed rest">
          ✕
        </button>
      </div>
    );
  }
  if (timerStart != null) {
    return (
      <button type="button" className={styles.timerLive} onClick={onStop} title="Stop — the elapsed rest is written to your next set automatically">
        <span className={styles.timerDigits}>{fmtRest(timerElapsed)}</span>
        <span className={styles.timerHint}>resting · tap to stop</span>
      </button>
    );
  }
  return (
    <div className={styles.timerIdleRow}>
      <button type="button" className={styles.timerStartBtn} onClick={onStart} title="Start after racking — stopping records the rest on your next set automatically">
        ⏱ Start rest
      </button>
    </div>
  );
}
