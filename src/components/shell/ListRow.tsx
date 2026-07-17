"use client";

import { useRouter } from "next/navigation";
import styles from "./ListRow.module.css";

// List-card of navigation rows (Train hub, More). Icon · name · live count ·
// chevron. Pure navigation — the destinations are the existing pages.
export function ListCard({ children }: { children: React.ReactNode }) {
  return <nav className={styles.card}>{children}</nav>;
}

export function ListRow({
  href,
  name,
  count,
  icon,
}: {
  href: string;
  name: string;
  count?: string | null;
  icon: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button type="button" className={styles.row} onClick={() => router.push(href)}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.name}>{name}</span>
      {count != null && <span className={styles.count}>{count}</span>}
      <svg className={styles.chevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
        <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </button>
  );
}
