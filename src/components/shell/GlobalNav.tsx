"use client";

import { usePathname, useRouter } from "next/navigation";
import styles from "./GlobalNav.module.css";

// Global bottom nav: Home / Train / Stats / More. Hidden on the title screen
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
    { label: "More", href: "/more", active: pathname === "/more" || pathname.startsWith("/more/"), icon: "M5 12h.01M12 12h.01M19 12h.01M5 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm7 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm7 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" },
  ];

  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
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
