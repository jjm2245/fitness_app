"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ExerciseSearch.module.css";
import { MOVEMENT_PATTERNS, suggestMovementPattern } from "@/lib/movementPatterns";

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

// The only distinction that matters to the engine is tagged vs untagged: an
// untagged exercise has no movement pattern, so it can't be a substitution
// candidate (and, if it has no muscles either, doesn't count toward volume).
// Provenance (curated/library/custom) is no longer surfaced — see DECISIONS.md.
export function ProvenanceBadge({ untagged }: { untagged?: boolean }) {
  return (
    <span className={`${styles.badge} ${untagged ? styles.untagged : styles.tagged}`}>
      {untagged ? "untagged" : "tagged"}
    </span>
  );
}

// Search the whole exercise graph and, as a fallback, create a free-typed
// custom. Used by the program/block editor and the logging screen's
// session-composition picker. When you pick (or create) an untagged exercise,
// a movement-pattern chooser (auto-suggested from the name) graduates it so it
// can substitute — you can also skip and leave it untagged.
export function ExerciseSearch({ onPick, placeholder }: { onPick: (r: ExerciseSearchResult) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ExerciseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<ExerciseSearchResult | null>(null);
  const [pattern, setPattern] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
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

  function finalize(r: ExerciseSearchResult) {
    onPick(r);
    setQ("");
    setResults([]);
    setPending(null);
  }

  // Tagged (or cardio, which is conditioning by nature) → pick straight through.
  // Untagged strength/accessory → open the movement-pattern chooser first.
  function handlePick(r: ExerciseSearchResult) {
    if (!r.untagged || r.conditioningOnly) {
      finalize(r);
      return;
    }
    setPattern(suggestMovementPattern(r.name) ?? "");
    setPending(r);
  }

  async function assignPattern() {
    if (!pending || !pattern) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(pending.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movementPattern: pattern }),
      });
      // On success the exercise is now tagged; reflect that downstream.
      finalize(res.ok ? { ...pending, untagged: false } : pending);
    } finally {
      setAssigning(false);
    }
  }

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
      if (res.ok) handlePick(await res.json());
    } finally {
      setCreating(false);
    }
  }

  if (pending) {
    return (
      <div className={styles.wrap}>
        <div className={styles.patternPrompt}>
          <div className={styles.patternTitle}>
            Movement pattern for <strong>{pending.name}</strong>
          </div>
          <p className={styles.patternHint}>
            Tag a pattern so it can stand in for similar lifts (substitutions). Auto-suggested from the name — change if it&rsquo;s off.
          </p>
          <select value={pattern} onChange={(e) => setPattern(e.target.value)} className={styles.patternSelect}>
            <option value="">Choose a pattern…</option>
            {MOVEMENT_PATTERNS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <div className={styles.patternActions}>
            <button type="button" onClick={assignPattern} disabled={!pattern || assigning} className={styles.assignBtn}>
              {assigning ? "Tagging…" : "Tag & add"}
            </button>
            <button type="button" onClick={() => finalize(pending)} className={styles.skipBtn}>
              Skip (leave untagged)
            </button>
          </div>
        </div>
      </div>
    );
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
                onClick={() => handlePick(r)}
              >
                <span>{r.name}</span>
                <ProvenanceBadge untagged={r.untagged} />
              </button>
            ))}
          {!loading && results.length === 0 && (
            <div className={styles.hint}>No matches.</div>
          )}
          <button type="button" className={styles.createBtn} onClick={createCustom} disabled={creating}>
            + Create custom &ldquo;{q.trim()}&rdquo; (you&rsquo;ll tag a movement pattern next)
          </button>
        </div>
      )}
    </div>
  );
}
