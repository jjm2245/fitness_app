"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./GlobalNav.module.css";
import { subscribeRestTimer, restElapsedSeconds, formatRest, type RestTimer } from "@/lib/restTimerBus";

// Global bottom nav: Home / Train / Stats. Settings lives behind a gear on
// Home — nav slots are reserved for frequent, direct destinations, and the
// freed fourth slot is held for Nutrition. See DECISIONS. Hidden on the title screen
// and during an active logging session, where the log page renders the
// SessionBar instead — navigating and training are different modes.

const TRAIN_PATHS = ["/train", "/sessions", "/program", "/blocks", "/exercises", "/equipment"];

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

export function GlobalNav() {
  const pathname = usePathname();
  const router = useRouter();

  // Session-bar exception: the active logging screen replaces the nav.
  if (pathname === "/login" || pathname.startsWith("/log/")) return null;

  const items = [
    { label: "Home", href: "/", active: pathname === "/", icon: "M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9z" },
    { label: "Train", href: "/train", active: TRAIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")), icon: "M2.5 12h2M19.5 12h2M6 8.5v7M18 8.5v7M8.5 12h7M6 7.5h.01M6 7.5a1.2 1.2 0 0 1 0 0M4.8 8.5h2.4v7H4.8v-7zM16.8 8.5h2.4v7h-2.4v-7z" },
    { label: "Stats", href: "/stats", active: pathname === "/stats" || pathname.startsWith("/stats/"), icon: "M4 20V10M10 20V4M16 20v-8M21 20H3" },
  ];

  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
      {/* The rest keeps running when you leave the session to look something
          up, so it has to be VISIBLE from wherever you went. Tapping returns
          to the session that owns it. */}
      <RestPill />
      <nav className={styles.nav}>
        {items.map((it) => (
          <button
            key={it.href}
            type="button"
            className={`${styles.item} ${it.active ? styles.active : ""}`}
            aria-current={it.active ? "page" : undefined}
            onClick={() => router.push(it.href)}
          >
            <Icon d={it.icon} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

// The running rest, shown on every non-session screen. Read-only: stopping and
// writing the rest stay with the card that owns it, exactly as before — this
// only means the count is not hidden while you are on Equipment.
function RestPill() {
  const router = useRouter();
  const [timer, setTimer] = useState<RestTimer | null>(null);
  const [, force] = useState(0);

  useEffect(() => subscribeRestTimer(setTimer), []);
  useEffect(() => {
    if (timer == null) return;
    // Re-render only — the seconds come from the stored start, so a throttled
    // interval in a backgrounded tab cannot lose time.
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [timer]);

  const elapsed = restElapsedSeconds(timer);
  if (timer == null || elapsed == null) return null;

  return (
    <button
      type="button"
      className={styles.restPill}
      onClick={() => router.push(`/log/${timer.sessionId}`)}
      title="Rest running — tap to return to your session"
    >
      <span className={styles.restDot} aria-hidden="true" />
      resting <strong>{formatRest(elapsed)}</strong>
    </button>
  );
}
