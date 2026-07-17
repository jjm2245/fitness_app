"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LockedTile.module.css";

// A future zone on Home/Stats, rendered honestly locked: muted, small lock,
// its section hue at low intensity. Tapping shows a one-line "later phase"
// note — no feature behind it yet, and none is built here.
export function LockedTile({
  name,
  sub,
  hue,
  icon,
}: {
  name: string;
  sub: string;
  hue: string; // a --hue-* token value, e.g. "var(--hue-recovery)"
  icon: React.ReactNode;
}) {
  const [note, setNote] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function tap() {
    setNote(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(false), 1800);
  }

  return (
    <button type="button" className={styles.tile} style={{ "--tile-hue": hue } as React.CSSProperties} onClick={tap}>
      <span className={styles.chip}>{icon}</span>
      <span>
        <span className={styles.name}>{name}</span>
        <br />
        <span className={styles.sub}>{sub}</span>
      </span>
      <svg className={styles.lock} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-label="Locked">
        <rect x="2" y="5" width="8" height="6" rx="1.5" fill="currentColor" />
        <path d="M4 5V3.5a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
      {note && <span className={styles.note}>Coming in a later phase</span>}
    </button>
  );
}
