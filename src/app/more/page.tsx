"use client";

import styles from "./more.module.css";
import { ListCard, ListRow } from "@/components/shell/ListRow";

// More — the catch-all list so nothing is ever orphaned from the bottom nav.
// Exercises and Equipment also live under Train; here they're one tap from
// anywhere. Settings-type rows appear here as they become real.
export default function MorePage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>More</h1>
      <ListCard>
        <ListRow
          href="/exercises"
          name="Exercises"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="5.5" width="2.5" height="5" rx="1" fill="currentColor" />
              <rect x="12" y="5.5" width="2.5" height="5" rx="1" fill="currentColor" />
              <rect x="4" y="7.25" width="8" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          }
        />
        <ListRow
          href="/equipment"
          name="Equipment"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2v3M8 11v3M2 8h3M11 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          }
        />
      </ListCard>
      <p className={styles.note}>Settings arrive with later phases.</p>
    </main>
  );
}
