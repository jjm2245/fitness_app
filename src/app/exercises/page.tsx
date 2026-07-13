"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./exercises.module.css";

interface ManagedExercise {
  id: string;
  name: string;
  source: string;
  canonicalName: string | null;
  movementPattern: string | null;
  untagged: boolean;
  day: string | null;
  loadType: string;
  kind: "library_name" | "named_on_ref" | "custom";
  loggedCount: number;
}

interface ExerciseMachine {
  id: string;
  notes: string | null;
  loggedCount: number;
}

const MACHINE_LOAD_TYPES = new Set(["machine_selectorized", "cable", "smith", "plate_loaded"]);

const KIND_LABEL: Record<ManagedExercise["kind"], string> = {
  library_name: "library name",
  named_on_ref: "your name → library",
  custom: "custom",
};

interface LibResult {
  id: string;
  name: string;
  source: string;
}

// Custom-exercise management (Part 3b). Lists everything that isn't a raw
// library row, badges the three naming kinds, and lets you rename, adopt the
// library's own name, or collapse a redundant custom into a library entry —
// which re-points all logged history so nothing is orphaned.
export default function ExercisesPage() {
  const [rows, setRows] = useState<ManagedExercise[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [collapsing, setCollapsing] = useState<string | null>(null);
  const [machinesFor, setMachinesFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/exercises/manage");
    if (res.ok) setRows(await res.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/exercises/manage");
      if (res.ok) setRows(await res.json());
      setLoaded(true);
    })();
  }, []);

  async function rename(id: string) {
    const name = editName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function adoptLibraryName(e: ManagedExercise) {
    if (!e.canonicalName || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(e.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: e.canonicalName }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  async function collapse(id: string, targetId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(id)}/collapse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (res.ok) {
        setCollapsing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1>My exercises</h1>
        <Link href="/sessions" className={styles.btn}>← Sessions</Link>
      </div>
      <p className={styles.hint}>
        Your named + custom exercises. <strong>library name</strong> uses the library&rsquo;s own name;{" "}
        <strong>your name → library</strong> is a precise name on a library reference;{" "}
        <strong>custom</strong> is your own, with no library link. &ldquo;Collapse&rdquo; moves all logged history onto the
        library entry, so nothing is orphaned.
      </p>

      {!loaded ? (
        <p className={styles.hint}>Loading…</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((e) => (
            <li key={e.id} className={styles.item}>
              <div className={styles.itemTop}>
                <span className={styles.name}>{e.name}</span>
                <span className={`${styles.badge} ${styles[`k_${e.kind}`]}`}>{KIND_LABEL[e.kind]}</span>
                {e.untagged && <span className={styles.meta}>· untagged</span>}
                {e.loggedCount > 0 && <span className={styles.meta}>· {e.loggedCount} logged</span>}
              </div>
              {e.kind === "named_on_ref" && e.canonicalName && (
                <div className={styles.refCanon}>library reference: {e.canonicalName}</div>
              )}

              {editing === e.id ? (
                <div className={styles.editRow}>
                  <input className={styles.input} value={editName} onChange={(ev) => setEditName(ev.target.value)} autoFocus />
                  <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => rename(e.id)} disabled={busy}>Save</button>
                  <button type="button" className={styles.btn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button type="button" className={styles.btn} onClick={() => { setEditing(e.id); setEditName(e.name); }}>Rename</button>
                  {e.kind === "named_on_ref" && (
                    <button type="button" className={styles.btn} onClick={() => adoptLibraryName(e)} disabled={busy}>Use library name</button>
                  )}
                  <button type="button" className={styles.btn} onClick={() => setCollapsing(collapsing === e.id ? null : e.id)}>
                    {collapsing === e.id ? "Close" : "Collapse into library…"}
                  </button>
                  {MACHINE_LOAD_TYPES.has(e.loadType) && (
                    <button type="button" className={styles.btn} onClick={() => setMachinesFor(machinesFor === e.id ? null : e.id)}>
                      {machinesFor === e.id ? "Close machines" : "Machines"}
                    </button>
                  )}
                </div>
              )}

              {collapsing === e.id && (
                <CollapsePicker exercise={e} onCollapse={(targetId) => collapse(e.id, targetId)} busy={busy} />
              )}

              {machinesFor === e.id && <MachinePanel exerciseId={e.id} />}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.links}>
        <Link href="/sessions">Sessions</Link>
        <Link href="/program">Program</Link>
        <Link href="/blocks">Blocks</Link>
      </div>
    </main>
  );
}

function CollapsePicker({ exercise, onCollapse, busy }: { exercise: ManagedExercise; onCollapse: (targetId: string) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibResult[]>([]);
  const show = q.trim().length >= 2;

  useEffect(() => {
    if (q.trim().length < 2) return; // stale results are hidden by `show`
    const t = setTimeout(async () => {
      const res = await fetch(`/api/exercises/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const all: LibResult[] = await res.json();
        // Only library targets, and never itself.
        setResults(all.filter((r) => r.source === "library" && r.id !== exercise.id));
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, exercise.id]);

  return (
    <div className={styles.collapseBox}>
      <p className={styles.warn}>
        Pick the library exercise this really is. {exercise.loggedCount > 0
          ? `Its ${exercise.loggedCount} logged entr${exercise.loggedCount === 1 ? "y" : "ies"} will move to it`
          : "Any logged history will move to it"} and &ldquo;{exercise.name}&rdquo; will be removed.
      </p>
      <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library…" autoFocus />
      {show && results.length > 0 && (
        <div className={styles.results}>
          {results.map((r) => (
            <button key={r.id} type="button" className={styles.result} onClick={() => onCollapse(r.id)} disabled={busy}>
              Collapse into: {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Per-exercise machine list (Part 3c): curate the machines that apply to this
// exercise (add / edit note / remove), complementing auto-create-on-first-use.
// "No machine" (the portable/free lane for progression) is always available at
// log time — it's the empty selection, not a row here.
function MachinePanel({ exerciseId }: { exerciseId: string }) {
  const [rows, setRows] = useState<ExerciseMachine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/machines`);
    if (res.ok) setRows(await res.json());
    setLoaded(true);
  }, [exerciseId]);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/machines`);
      if (res.ok) setRows(await res.json());
      setLoaded(true);
    })();
  }, [exerciseId]);

  async function add() {
    const l = label.trim();
    if (!l || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/machines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: l, notes: note.trim() || undefined }),
      });
      if (res.ok) {
        setLabel("");
        setNote("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(machineId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/machines/${encodeURIComponent(machineId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: editNote }),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(machineId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/machines/${encodeURIComponent(machineId)}`, {
        method: "DELETE",
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.collapseBox}>
      <p className={styles.warn}>
        Machines for this exercise. &ldquo;No machine&rdquo; (the portable/free lane) is always an option when logging.
      </p>
      {!loaded ? (
        <p className={styles.meta}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.meta}>No machines yet — add one below, or they appear automatically the first time you log with one.</p>
      ) : (
        <ul className={styles.list} style={{ marginBottom: 8 }}>
          {rows.map((m) => (
            <li key={m.id} className={styles.itemTop} style={{ justifyContent: "space-between" }}>
              <span>
                <span className={styles.name}>{m.id}</span>
                {m.notes ? <span className={styles.meta}> · {m.notes}</span> : null}
                {m.loggedCount > 0 ? <span className={styles.meta}> · {m.loggedCount} logged</span> : null}
              </span>
              {editing === m.id ? (
                <span className={styles.editRow}>
                  <input className={styles.input} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="note" />
                  <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => saveNote(m.id)} disabled={busy}>Save</button>
                  <button type="button" className={styles.btn} onClick={() => setEditing(null)}>Cancel</button>
                </span>
              ) : (
                <span className={styles.actions} style={{ marginTop: 0 }}>
                  <button type="button" className={styles.btn} onClick={() => { setEditing(m.id); setEditNote(m.notes ?? ""); }}>Edit note</button>
                  <button type="button" className={styles.btn} onClick={() => remove(m.id)} disabled={busy}>Remove</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.editRow}>
        <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder='label, e.g. "by the mirror"' />
        <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" style={{ minWidth: 140 }} />
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={add} disabled={busy || !label.trim()}>Add machine</button>
      </div>
    </div>
  );
}
