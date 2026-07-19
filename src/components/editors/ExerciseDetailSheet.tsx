"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import { ExerciseSearch } from "@/components/ExerciseSearch";
import styles from "./editors.module.css";
import { api } from "./types";

export interface ManagedExercise {
  id: string;
  name: string;
  source: string;
  canonicalName: string | null;
  movementPattern: string | null;
  untagged: boolean;
  unilateral: boolean;
  day: string | null;
  loadType: string;
  description: string | null;
  kind: "library_name" | "named_on_ref" | "custom";
  loggedCount: number;
  primaryMuscle: string | null;
}

interface ExerciseEquipment {
  id: string;
  label: string;
  notes: string | null;
  loggedCount: number;
}

interface LibResult {
  id: string;
  name: string;
  source: string;
}

export const KIND_LABEL: Record<ManagedExercise["kind"], string> = {
  library_name: "library name",
  named_on_ref: "your name → library",
  custom: "custom",
};

// The exercise detail sheet — everything the six always-visible buttons did,
// behind one tap: rename, description, unilateral, equipment associations,
// collapse-into-library (destructive-adjacent merge, copy kept), history-safe
// remove (409 + Keep). Sections disclose on demand within the sheet.
export function ExerciseDetailSheet({
  ex,
  onChanged,
  onClose,
}: {
  ex: ManagedExercise;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(ex.name);
  const [description, setDescription] = useState(ex.description ?? "");
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<null | "equipment" | "collapse" | "remove">(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/exercises/${encodeURIComponent(ex.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeExercise() {
    setBusy(true);
    setRemoveErr(null);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(ex.id)}`, { method: "DELETE" });
      if (res.ok) {
        await onChanged();
        onClose();
      } else {
        const body = await res.json().catch(() => null);
        setRemoveErr(body?.message ?? "Couldn't remove this exercise.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function collapse(targetId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(ex.id)}/collapse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (res.ok) {
        await onChanged();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={ex.name}
      subtitle={
        <>
          <span className={styles.badge}>{KIND_LABEL[ex.kind]}</span>
          {ex.untagged && <span className={styles.badgeWarn} style={{ marginLeft: 6 }}>untagged</span>}
          {ex.loggedCount > 0 && <span className={styles.sheetRowMuted} style={{ marginLeft: 6 }}>· {ex.loggedCount} logged</span>}
        </>
      }
      onClose={onClose}
    >
      {ex.kind === "named_on_ref" && ex.canonicalName && (
        <p className={styles.fieldNote}>Library reference: {ex.canonicalName}</p>
      )}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <div className={styles.fieldRow}>
          <input className={styles.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className={styles.quietBtn}
            disabled={busy || name.trim() === "" || name === ex.name}
            onClick={() => patch({ name: name.trim() })}
          >
            Save
          </button>
        </div>
        {ex.kind === "named_on_ref" && ex.canonicalName && (
          <button
            type="button"
            className={styles.quietBtn}
            style={{ marginTop: 6, alignSelf: "flex-start" }}
            disabled={busy}
            onClick={() => { setName(ex.canonicalName!); patch({ name: ex.canonicalName }); }}
          >
            Use library name
          </button>
        )}
      </div>

      <div className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Description</span>
        <textarea
          className={styles.fieldArea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="How you actually do it — grip, ROM, setup… (optional)"
          rows={2}
        />
        <button
          type="button"
          className={styles.quietBtn}
          style={{ marginTop: 6, alignSelf: "flex-start" }}
          disabled={busy || description === (ex.description ?? "")}
          onClick={() => patch({ description })}
        >
          Save description
        </button>
      </div>

      <div className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Unilateral</span>
        <div className={styles.movePair}>
          <button
            type="button"
            className={!ex.unilateral ? styles.toggleActive : styles.toggleBtn}
            disabled={busy}
            onClick={() => { if (ex.unilateral) patch({ unilateral: false }); }}
          >
            Bilateral
          </button>
          <button
            type="button"
            className={ex.unilateral ? styles.toggleActive : styles.toggleBtn}
            disabled={busy}
            onClick={() => { if (!ex.unilateral) patch({ unilateral: true }); }}
          >
            Unilateral (L/R)
          </button>
        </div>
      </div>

      <div className={styles.sectionLabel}>More</div>
      <div className={styles.sheetList}>
        <button type="button" className={styles.sheetRow} onClick={() => setSection(section === "equipment" ? null : "equipment")}>
          <span style={{ flex: 1 }}>Equipment units</span>
          <span className={styles.sheetRowMuted}>{section === "equipment" ? "Close" : "Manage"}</span>
        </button>
        {section === "equipment" && <EquipmentPanel exerciseId={ex.id} />}

        <button type="button" className={styles.sheetRow} onClick={() => setSection(section === "collapse" ? null : "collapse")}>
          <span style={{ flex: 1 }}>Collapse into library…</span>
          <span className={styles.sheetRowMuted}>{section === "collapse" ? "Close" : "Merge"}</span>
        </button>
        {section === "collapse" && <CollapsePicker ex={ex} onCollapse={collapse} busy={busy} />}

        <button type="button" className={styles.sheetRow} onClick={() => { setSection(section === "remove" ? null : "remove"); setRemoveErr(null); }}>
          <span style={{ flex: 1, color: "var(--danger)" }}>Remove exercise</span>
          <span className={styles.sheetRowMuted}>{section === "remove" ? "Close" : ""}</span>
        </button>
        {section === "remove" && (
          <RemoveBox ex={ex} err={removeErr} busy={busy} onRemove={removeExercise} onCancel={() => setSection(null)} />
        )}
      </div>
    </Sheet>
  );
}

function RemoveBox({
  ex,
  err,
  busy,
  onRemove,
  onCancel,
}: {
  ex: ManagedExercise;
  err: string | null;
  busy: boolean;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.warnBox} style={{ marginTop: 8 }}>
      {ex.loggedCount > 0 ? (
        <p>
          <strong>{ex.name}</strong> has <strong>{ex.loggedCount} logged {ex.loggedCount === 1 ? "entry" : "entries"}</strong>.
          Removing it would orphan that history, so it&rsquo;s blocked — use <em>Collapse into library…</em> to move the
          history onto another exercise first, or keep it.
        </p>
      ) : (
        <p>Remove <strong>{ex.name}</strong>? This can&rsquo;t be undone.</p>
      )}
      {err && <p className={styles.errText}>{err}</p>}
      <div className={styles.sheetActions} style={{ marginTop: 10 }}>
        {ex.loggedCount === 0 && (
          <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={onRemove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </button>
        )}
        <button type="button" className={styles.quietBtn} onClick={onCancel}>
          {ex.loggedCount > 0 ? "Keep" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function CollapsePicker({ ex, onCollapse, busy }: { ex: ManagedExercise; onCollapse: (targetId: string) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibResult[]>([]);
  const show = q.trim().length >= 2;

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/exercises/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const all: LibResult[] = await res.json();
        setResults(all.filter((r) => r.source === "library" && r.id !== ex.id));
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, ex.id]);

  return (
    <div className={styles.warnBox} style={{ marginTop: 8 }}>
      <p style={{ marginBottom: 8 }}>
        Pick the library exercise this really is.{" "}
        {ex.loggedCount > 0
          ? `Its ${ex.loggedCount} logged entr${ex.loggedCount === 1 ? "y" : "ies"} will move to it`
          : "Any logged history will move to it"}{" "}
        and &ldquo;{ex.name}&rdquo; will be removed.
      </p>
      <input className={styles.fieldInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library…" />
      {show && results.length > 0 && (
        <div className={styles.sheetList} style={{ marginTop: 6 }}>
          {results.map((r) => (
            <button key={r.id} type="button" className={styles.sheetRow} onClick={() => onCollapse(r.id)} disabled={busy}>
              Collapse into: {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EquipmentPanel({ exerciseId }: { exerciseId: string }) {
  const [rows, setRows] = useState<ExerciseEquipment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment`);
    if (res.ok) setRows(await res.json());
    setLoaded(true);
  }, [exerciseId]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const l = label.trim();
    if (!l || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), label: l, notes: note.trim() || undefined }),
      });
      if (res.ok) { setLabel(""); setNote(""); await load(); }
    } finally {
      setBusy(false);
    }
  }

  async function remove(equipmentId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment/${encodeURIComponent(equipmentId)}`, {
        method: "DELETE",
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.warnBox} style={{ marginTop: 8 }}>
      <p style={{ marginBottom: 8 }}>
        Units for this exercise. Context-bound types (cable/selectorized/Smith/plate-loaded) track each unit as its own
        lane when logging.
      </p>
      {!loaded ? (
        <p className={styles.sheetRowMuted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.sheetRowMuted}>No units yet — add one, or they appear automatically the first time you log with one.</p>
      ) : (
        <div className={styles.sheetList}>
          {rows.map((m) => (
            <div key={m.id} className={`${styles.sheetRow} ${styles.sheetRowStatic}`}>
              <span style={{ flex: 1 }}>
                {m.label}
                {m.notes ? <span className={styles.sheetRowMuted}> · {m.notes}</span> : null}
                {m.loggedCount > 0 ? <span className={styles.sheetRowMuted}> · {m.loggedCount} logged</span> : null}
              </span>
              <button type="button" className={styles.quietBtn} onClick={() => remove(m.id)} disabled={busy}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.fieldRow} style={{ marginTop: 8 }}>
        <input className={styles.fieldInput} value={label} onChange={(e) => setLabel(e.target.value)} placeholder='unit label, e.g. "by the mirror"' />
        <button type="button" className={styles.quietBtn} onClick={add} disabled={busy || !label.trim()}>Add</button>
      </div>
    </div>
  );
}

// Re-exported so the list page can render tag-on-add through the same search.
export { ExerciseSearch };
