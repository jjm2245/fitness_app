"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { DayEditorView } from "@/components/editors/DayEditorView";
import { api, type EditorDay } from "@/components/editors/types";

// Reusable blocks (phase 3) — the same editor engine as /program with block
// labels. A block is structurally a program_day; attach one to a session in a
// tap from the logging screen.
export default function BlocksEditorPage() {
  const [blocks, setBlocks] = useState<EditorDay[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setBlocks(await api<EditorDay[]>("/api/blocks"));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Reusable blocks</h1>
      </div>
      <p className={styles.hintLine}>Reusable exercise bundles you attach to any session — finishers, warm-ups, extras. Not tied to a day or a program.</p>

      {!loaded ? (
        <p className={styles.hintLine}>Loading…</p>
      ) : (
        <DayEditorView days={blocks} noun="block" createTitle="New block" onChanged={refresh} />
      )}
    </main>
  );
}
