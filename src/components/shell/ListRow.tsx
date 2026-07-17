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
  pending,
  icon,
}: {
  href: string;
  name: string;
  count?: string | null;
  // Count still loading — hold its slot with a skeleton so nothing shifts
  // when the value lands. Rows that never carry a count omit both props.
  pending?: boolean;
  icon: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button type="button" className={styles.row} onClick={() => router.push(href)}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.name}>{name}</span>
      {count != null ? (
        <span className={styles.count}>{count}</span>
      ) : pending ? (
        <span className={styles.countSkeleton} aria-hidden="true" />
      ) : null}
      <svg className={styles.chevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
        <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </button>
  );
}
