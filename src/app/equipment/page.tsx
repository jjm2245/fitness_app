"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "../exercises/exercises.module.css";

// Equipment section (Part 3) — mirrors the Exercises section. Units are
// surrogate-keyed: the id is opaque and stable (logged sets reference it), the
// label is display-only, so names stop carrying data — structured fields hold
// gym/brand/type/built-in weight and notes hold everything else. Renames touch
// one row; duplicate-label renames warn (409) and offer merge; deletes are
// history-safe (blocked while logged sets reference the unit).

interface EquipmentUnit {
  id: string;
  label: string;
  gym: string | null;
  brand: string | null;
  model: string | null;
  builtInWeight: string | null;
  equipmentType: string | null;
  pulleyRatioKind: string;
  notes: string | null;
  exercises: Array<{ exerciseId: string; name: string }>;
  loggedCount: number;
}

interface EditState {
  label: string;
  gym: string;
  brand: string;
  model: string;
  builtInWeight: string;
  equipmentType: string;
  pulleyRatioKind: string;
  notes: string;
}

const EQUIPMENT_UNIT_TYPES = ["", "selectorized", "plate_loaded", "cable", "smith", "other"];

export default function EquipmentPage() {
  const [rows, setRows] = useState<EquipmentUnit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; message: string; existingId?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/equipment");
    if (res.ok) setRows(await res.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/equipment");
      if (res.ok) setRows(await res.json());
      setLoaded(true);
    })();
  }, []);

  function startEdit(m: EquipmentUnit) {
    setErr(null);
    setEditing(m.id);
    setEdit({
      label: m.label,
      gym: m.gym ?? "",
      brand: m.brand ?? "",
      model: m.model ?? "",
      builtInWeight: m.builtInWeight != null ? String(Number(m.builtInWeight)) : "",
      equipmentType: m.equipmentType ?? "",
      pulleyRatioKind: m.pulleyRatioKind ?? "unknown",
      notes: m.notes ?? "",
    });
  }

  async function save(id: string) {
    if (!edit || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: edit.label,
          gym: edit.gym,
          brand: edit.brand,
          model: edit.model,
          equipmentType: edit.equipmentType,
          pulleyRatioKind: edit.pulleyRatioKind,
          notes: edit.notes,
          builtInWeight: edit.builtInWeight.trim() === "" ? null : Number(edit.builtInWeight),
        }),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      } else {
        const body = await res.json().catch(() => null);
        // duplicate_label: explicit warning, never a silent merge.
        setErr({ id, message: body?.message ?? "Couldn't save.", existingId: body?.existingId });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: EquipmentUnit) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(m.id)}`, { method: "DELETE" });
      if (res.ok) await load();
      else {
        const body = await res.json().catch(() => null);
        setErr({ id: m.id, message: body?.message ?? "Couldn't delete." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function merge(sourceId: string, targetId: string) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(sourceId)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (res.ok) {
        setMerging(null);
        setEditing(null);
        await load();
      } else {
        const body = await res.json().catch(() => null);
        setErr({ id: sourceId, message: body?.message ?? "Merge failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1>Equipment</h1>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Link href="/exercises" className={styles.btn}>Exercises</Link>
          <Link href="/sessions" className={styles.btn}>← Sessions</Link>
        </span>
      </div>
      <p className={styles.hint}>
        Equipment units are labelled for you, not for the data — gym, brand, type, and <strong>built-in weight</strong> live in
        structured fields (built-in weight is auto-added to every set&rsquo;s effective load), and the description holds
        everything else. Deleting is blocked while logged sets reference a unit — <strong>merge</strong> duplicates
        instead (history moves, never orphans).
      </p>

      {!loaded ? (
        <p className={styles.hint}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.hint}>No equipment units yet — they appear when you add one while logging, or via an exercise&rsquo;s Equipment panel.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((m) => (
            <li key={m.id} className={styles.item}>
              <div className={styles.itemTop}>
                <span className={styles.name}>{m.label}</span>
                {m.equipmentType && <span className={styles.meta}>· {m.equipmentType}</span>}
                {m.builtInWeight != null && <span className={styles.meta}>· +{Number(m.builtInWeight)} lb built-in</span>}
                {m.pulleyRatioKind !== "unknown" && <span className={styles.meta}>· pulley {m.pulleyRatioKind}</span>}
                {m.loggedCount > 0 && <span className={styles.meta}>· {m.loggedCount} logged</span>}
              </div>
              {(m.gym || m.brand || m.model) && (
                <div className={styles.refCanon}>{[m.brand, m.model, m.gym].filter(Boolean).join(" · ")}</div>
              )}
              {m.notes && <div className={styles.description}>{m.notes}</div>}
              {m.exercises.length > 0 && (
                <div className={styles.refCanon}>used by: {m.exercises.map((e) => e.name).join(", ")}</div>
              )}

              {editing === m.id && edit ? (
                <div className={styles.editRow} style={{ flexWrap: "wrap" }}>
                  <input className={styles.input} value={edit.label} onChange={(ev) => setEdit({ ...edit, label: ev.target.value })} placeholder="label" />
                  <input className={styles.input} value={edit.gym} onChange={(ev) => setEdit({ ...edit, gym: ev.target.value })} placeholder="gym / location" />
                  <input className={styles.input} value={edit.brand} onChange={(ev) => setEdit({ ...edit, brand: ev.target.value })} placeholder="manufacturer" />
                  <input className={styles.input} value={edit.model} onChange={(ev) => setEdit({ ...edit, model: ev.target.value })} placeholder="model" />
                  <input className={styles.input} type="number" value={edit.builtInWeight} onChange={(ev) => setEdit({ ...edit, builtInWeight: ev.target.value })} placeholder="built-in lb" style={{ width: 90 }} title="Constant added weight (bar/handles/carriage) — auto-added to logged loads" />
                  <select className={styles.input} value={edit.equipmentType} onChange={(ev) => setEdit({ ...edit, equipmentType: ev.target.value })}>
                    {EQUIPMENT_UNIT_TYPES.map((t) => <option key={t} value={t}>{t === "" ? "type…" : t}</option>)}
                  </select>
                  <select className={styles.input} value={edit.pulleyRatioKind} onChange={(ev) => setEdit({ ...edit, pulleyRatioKind: ev.target.value })} title="Interpretation only — never folded into logged loads (a ratio cancels out of every lane-scoped comparison).">
                    {["unknown", "1:1", "2:1", "other"].map((r) => <option key={r} value={r}>pulley {r}</option>)}
                  </select>
                  <textarea className={styles.input} value={edit.notes} onChange={(ev) => setEdit({ ...edit, notes: ev.target.value })} placeholder="description — serials, links, quirks…" rows={2} style={{ flex: "1 1 100%", resize: "vertical", fontFamily: "inherit" }} />
                  <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => save(m.id)} disabled={busy}>Save</button>
                  <button type="button" className={styles.btn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button type="button" className={styles.btn} onClick={() => startEdit(m)}>Edit</button>
                  <button type="button" className={styles.btn} onClick={() => { setMerging(merging === m.id ? null : m.id); setErr(null); }}>
                    {merging === m.id ? "Close merge" : "Merge into…"}
                  </button>
                  <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => remove(m)} disabled={busy}>Delete</button>
                </div>
              )}

              {merging === m.id && (
                <div className={styles.removeBox}>
                  <p className={styles.removeWarn}>
                    Merge <strong>{m.label}</strong> into another unit — its {m.loggedCount} logged set{m.loggedCount === 1 ? "" : "s"} and
                    exercise links move over, then this entry is deleted.
                  </p>
                  <div className={styles.actions}>
                    {rows.filter((t) => t.id !== m.id).map((t) => (
                      <button key={t.id} type="button" className={styles.btn} onClick={() => merge(m.id, t.id)} disabled={busy}>→ {t.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {err?.id === m.id && (
                <div className={styles.removeBox}>
                  <p className={styles.removeErr}>{err.message}</p>
                  {err.existingId && (
                    <div className={styles.actions}>
                      <button type="button" className={styles.btn} onClick={() => merge(m.id, err.existingId!)} disabled={busy}>
                        Merge into the existing one
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.links}>
        <Link href="/sessions">Sessions</Link>
        <Link href="/exercises">Exercises</Link>
        <Link href="/program">Program</Link>
        <Link href="/blocks">Blocks</Link>
      </div>
    </main>
  );
}
