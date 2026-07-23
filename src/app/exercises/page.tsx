"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/components/editors/editors.module.css";
import { Sheet } from "@/components/session/Sheet";
import { ExerciseDetailSheet, type ManagedExercise } from "@/components/editors/ExerciseDetailSheet";
import { MOVEMENT_PATTERNS, suggestMovementPattern } from "@/lib/movementPatterns";
import { api } from "@/components/editors/types";

type Tab = "all" | "library" | "renamed" | "custom";

// Initial render cap + the "See 50 more" step. The manage payload is the full
// catalog (~880 rows) fetched once and filtered client-side; rendering starts
// capped and grows on demand so the list stays fast on a phone.
const RENDER_CAP = 150;
const RENDER_STEP = 50;

// A search is "thin" when it matches this few rows — offer create-your-own.
const THIN_RESULTS = 5;

// Exercises (exercise-section v2 + polish): four tabs over the FULL catalog,
// quiet rows, a Logged filter chip, "See 50 more" pagination, and a direct
// create-custom flow (no library-search add sheet — with the whole catalog
// visible, "picking" a library row is a no-op by definition on this page).
export default function ExercisesPage() {
  const [rows, setRows] = useState<ManagedExercise[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [loggedOnly, setLoggedOnly] = useState(false);
  const [cap, setCap] = useState(RENDER_CAP);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ draft: string } | null>(null);

  const load = useCallback(async () => {
    setRows(await api<ManagedExercise[]>("/api/exercises/manage"));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Deep link: /exercises?edit=<id> opens that exercise's sheet (used by the
  // program/blocks target sheet). Read once, then strip the param so closing
  // the sheet doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const edit = params.get("edit");
    if (edit) {
      setOpenId(edit);
      params.delete("edit");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  // Narrowing changes reset the rendered window.
  useEffect(() => { setCap(RENDER_CAP); }, [q, tab, loggedOnly]);

  const isRenamed = (e: ManagedExercise) => e.canonicalName != null && e.name !== e.canonicalName;
  const displayName = (e: ManagedExercise) => (tab === "library" ? e.canonicalName ?? e.name : e.name);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inTab = rows.filter((e) => {
      if (tab === "library") return e.canonicalName != null;
      if (tab === "renamed") return isRenamed(e);
      if (tab === "custom") return e.canonicalName == null;
      return true; // all
    });
    const logged = loggedOnly ? inTab.filter((e) => e.loggedCount > 0) : inTab;
    const matched = needle
      ? logged.filter(
          (e) =>
            e.name.toLowerCase().includes(needle) ||
            (e.canonicalName ?? "").toLowerCase().includes(needle)
        )
      : logged;
    const byName = (e: ManagedExercise) => (tab === "library" ? e.canonicalName ?? e.name : e.name);
    return [...matched].sort((a, b) => byName(a).localeCompare(byName(b)));
  }, [rows, q, tab, loggedOnly]);

  const visible = shown.slice(0, cap);
  const thinSearch = q.trim().length >= 2 && shown.length <= THIN_RESULTS;

  const open = rows.find((e) => e.id === openId) ?? null;

  const humanize = (s: string) => s.replace(/_/g, " ");

  function subline(e: ManagedExercise): string {
    const parts: (string | null)[] = [];
    if (tab === "library" && isRenamed(e)) parts.push(`renamed “${e.name}”`);
    if (tab === "all") {
      if (e.canonicalName == null) parts.push("custom");
      else if (isRenamed(e)) parts.push("renamed");
    }
    parts.push(e.primaryMuscle ? humanize(e.primaryMuscle) : null);
    parts.push(e.loadType && e.loadType !== "unknown" ? humanize(e.loadType) : null);
    parts.push(e.loggedCount > 0 ? `${e.loggedCount} logged` : null);
    return parts.filter(Boolean).join(" · ");
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "library", label: "Library" },
    { id: "renamed", label: "Renamed" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Exercises</h1>
      </div>
      <p className={styles.hintLine}>
        Rename anything to what you call it, create your own, and set each exercise&rsquo;s type, tag, equipment, and how it logs.
      </p>

      <div className={styles.searchRow}>
        <input
          className={styles.fieldInput}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search exercises…"
          type="search"
        />
      </div>
      <div className={styles.filterRow}>
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? styles.filterChipActive : styles.filterChip} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className={loggedOnly ? styles.filterChipActive : styles.filterChip}
          style={{ marginLeft: "auto" }}
          onClick={() => setLoggedOnly((v) => !v)}
          aria-pressed={loggedOnly}
        >
          Logged
        </button>
      </div>

      {/* Compact create action — visible on every tab (creation is the point on
          Custom, but a custom is creatable from anywhere). */}
      <button type="button" className={styles.newCustomBtn} onClick={() => setCreating({ draft: "" })}>
        ＋ New custom exercise
      </button>

      <div className={styles.rowsCard}>
        {!loaded ? (
          <p className={styles.emptyNote}>Loading…</p>
        ) : visible.length === 0 && !thinSearch ? (
          <p className={styles.emptyNote}>No matches.</p>
        ) : (
          <>
            {visible.map((e) => (
              <button key={e.id} type="button" className={styles.row} onClick={() => setOpenId(e.id)}>
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>
                    <span className={styles.rowNameText}>{displayName(e)}</span>
                    {tab === "library" && isRenamed(e) && <span className={styles.renamedDot} aria-label="renamed" />}
                  </span>
                  {subline(e) && <span className={styles.rowSub}>{subline(e)}</span>}
                </span>
                <svg className={styles.rowChevron} width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
                  <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            ))}
            {shown.length > cap && (
              <>
                <p className={styles.emptyNote}>Showing {cap} of {shown.length}.</p>
                <button type="button" className={styles.addRow} onClick={() => setCap((c) => c + RENDER_STEP)}>
                  See {Math.min(RENDER_STEP, shown.length - cap)} more
                </button>
              </>
            )}
            {thinSearch && (
              <button type="button" className={styles.addRow} onClick={() => setCreating({ draft: q.trim() })}>
                Not finding what you need? Create your own exercise
              </button>
            )}
          </>
        )}
      </div>

      {open && <ExerciseDetailSheet ex={open} onChanged={load} onClose={() => setOpenId(null)} />}
      {creating && (
        <CreateCustomSheet
          draft={creating.draft}
          onClose={() => setCreating(null)}
          onCreated={async (id) => {
            setCreating(null);
            await load();
            setOpenId(id); // the new custom's edit sheet opens right away
          }}
        />
      )}
    </main>
  );
}

// Direct create-custom flow: name → create → movement-pattern tag (or skip).
// No library search step — that belongs to contexts that add to a container.
function CreateCustomSheet({
  draft,
  onClose,
  onCreated,
}: {
  draft: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(draft);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/exercises/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (!res.ok) { setErr("Couldn't create — try again."); return; }
      const row = (await res.json()) as { id: string; name: string };
      setCreated(row);
      setPattern(suggestMovementPattern(row.name) ?? "");
    } finally {
      setBusy(false);
    }
  }

  async function tagAndFinish() {
    if (!created) return;
    if (pattern) {
      setBusy(true);
      try {
        await fetch(`/api/exercises/${encodeURIComponent(created.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movementPattern: pattern }),
        });
      } finally {
        setBusy(false);
      }
    }
    onCreated(created.id);
  }

  return (
    <Sheet
      title="New custom exercise"
      subtitle={created ? "Tag a movement pattern so it can substitute — or skip." : "Name it what you actually call it."}
      onClose={created ? () => onCreated(created.id) : onClose}
    >
      {!created ? (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              className={styles.fieldInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bayesian Curl"
              autoFocus
            />
          </div>
          {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.primaryBtn} onClick={create} disabled={busy || name.trim() === ""}>
              Create
            </button>
            <button type="button" className={styles.quietBtn} onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Movement pattern for {created.name}</span>
            <select className={styles.fieldInput} value={pattern} onChange={(e) => setPattern(e.target.value)}>
              <option value="">Choose a pattern…</option>
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <span className={styles.fieldNote}>Auto-suggested from the name — change if it&rsquo;s off. Tagging Conditioning also marks it cardio.</span>
          </div>
          <div className={styles.sheetActions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.primaryBtn} onClick={tagAndFinish} disabled={busy || !pattern}>
              Tag &amp; finish
            </button>
            <button type="button" className={styles.quietBtn} onClick={() => onCreated(created.id)}>
              Skip (leave untagged)
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
