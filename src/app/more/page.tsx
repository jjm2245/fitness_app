"use client";

import styles from "./more.module.css";
import pkg from "../../../package.json";

// More — deliberately near-empty. Exercises and Equipment live under Train
// (having them here too made the IA feel accidental — owner call, phase 1.5);
// settings-type rows appear here as they become real.
export default function MorePage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>More</h1>
      <p className={styles.note}>Settings arrive with later phases.</p>
      <p className={styles.version}>Fitness Agent v{pkg.version}</p>
    </main>
  );
}
