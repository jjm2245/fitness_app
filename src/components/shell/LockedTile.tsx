"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LockedTile.module.css";

// A zone tile on Home/Stats. Locked (the default) renders honestly muted with
// a small lock and a "later phase" note on tap — no feature behind it, none
// pretended. A LIVE tile is the same chrome unlocked: chevron instead of lock,
// tap navigates. `tag` replaces the lock with a small word ("next") for a zone
// that is queued rather than distant. One component so the hub never has to be
// remodeled as zones light up — they light up in place.
export function LockedTile({
  name,
  sub,
  hue,
  icon,
  live = false,
  onOpen,
  tag,
}: {
  name: string;
  sub: string;
  hue: string; // a --hue-* token value, e.g. "var(--hue-recovery)"
  icon: React.ReactNode;
  /** Unlocked: chevron, tap navigates via onOpen. */
  live?: boolean;
  onOpen?: () => void;
  /** Replaces the lock icon with a small label, e.g. "next". */
  tag?: string;
}) {
  const [note, setNote] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function tap() {
    if (live) return onOpen?.();
    setNote(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(false), 1800);
  }

  return (
    <button
      type="button"
      className={`${styles.tile} ${live ? styles.live : ""}`}
      style={{ "--tile-hue": hue } as React.CSSProperties}
      onClick={tap}
    >
      <span className={styles.chip}>{icon}</span>
      <span>
        <span className={styles.name}>{name}</span>
        <br />
        <span className={styles.sub}>{sub}</span>
      </span>
      {live ? (
        <span className={styles.chev} aria-hidden="true">›</span>
      ) : tag ? (
        <span className={styles.tag}>{tag}</span>
      ) : (
        <svg className={styles.lock} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-label="Locked">
          <rect x="2" y="5" width="8" height="6" rx="1.5" fill="currentColor" />
          <path d="M4 5V3.5a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      )}
      {note && !live && <span className={styles.note}>Coming in a later phase</span>}
    </button>
  );
}
