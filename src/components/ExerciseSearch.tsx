"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ExerciseSearch.module.css";

export interface ExerciseSearchResult {
  id: string;
  name: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  source: "curated" | "library" | "custom";
  untagged: boolean;
  canonicalName?: string | null;
}

const BADGE: Record<string, { label: string; className: string }> = {
  curated: { label: "curated", className: "curated" },
  library: { label: "library", className: "library" },
  custom: { label: "custom", className: "custom" },
};

export function ProvenanceBadge({ source, untagged }: { source: string; untagged?: boolean }) {
  if (untagged) return <span className={`${styles.badge} ${styles.untagged}`}>untagged</span>;
  const b = BADGE[source] ?? BADGE.custom;
  return <span className={`${styles.badge} ${styles[b.className]}`}>{b.label}</span>;
}

// Search the whole graph (curated + library + custom) and, as a fallback,
// create a free-typed custom exercise. Used by both the program/block editor
// and the logging screen's session-composition picker.
export function ExerciseSearch({ onPick, placeholder }: { onPick: (r: ExerciseSearchResult) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ExerciseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = q.trim().length >= 2;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return; // stale results simply aren't shown (see `show`)
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/exercises/search?q=${encodeURIComponent(q.trim())}`);
        setResults(res.ok ? await res.json() : []);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  async function createCustom() {
    const name = q.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/exercises/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const row: ExerciseSearchResult = await res.json();
        onPick(row);
        setQ("");
        setResults([]);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? "Search exercises…"}
        className={styles.input}
      />
      {show && (
        <div className={styles.results}>
          {loading && <div className={styles.hint}>Searching…</div>}
          {!loading &&
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                className={styles.result}
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setResults([]);
                }}
              >
                <span>{r.name}</span>
                <ProvenanceBadge source={r.source} untagged={r.untagged} />
              </button>
            ))}
          {!loading && results.length === 0 && (
            <div className={styles.hint}>No matches.</div>
          )}
          <button type="button" className={styles.createBtn} onClick={createCustom} disabled={creating}>
            + Create custom &ldquo;{q.trim()}&rdquo; (untagged — excluded from volume/substitution until tagged)
          </button>
        </div>
      )}
    </div>
  );
}
