"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import { NumberInput } from "@/components/NumberInput";
import styles from "./settings.module.css";
import editors from "@/components/editors/editors.module.css";
import { kgToLb, lbToKg, displayLb, type WeightUnit } from "@/lib/units";

// The weigh-in history — the one place weigh-ins are MANAGED. The Settings row
// stays a summary of the latest entry and opens this.
//
// Every entry is editable in both dimensions, because a weigh-in can be wrong
// in either: the number (mistyped) or the day (entered the morning after).
// Deleting is offered because throwaway entries happen while trying a new
// screen, and a body-composition history that can't be corrected isn't one you
// can trust.

export interface WeighIn {
  id: number;
  date: string;
  weightLb: number;
}

/** Local calendar parts — passing YYYY-MM-DD to `new Date()` parses it as UTC
 *  midnight and renders the previous day west of Greenwich. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayIso(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** Canonical lb → the number shown in the active unit. */
const shown = (lb: number, unit: WeightUnit) => (unit === "kg" ? lbToKg(lb) : displayLb(lb));
/** …and back. Conversion happens at the boundary; storage is always lb. */
const toLb = (entered: number, unit: WeightUnit) => (unit === "kg" ? kgToLb(entered) : entered);

export function WeighInHistory({
  unit,
  onClose,
  onChanged,
}: {
  unit: WeightUnit;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<WeighIn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  // The add form, kept at the bottom so the list is what you see first.
  const [newWeight, setNewWeight] = useState("");
  const [newDate, setNewDate] = useState(todayIso());

  async function load() {
    try {
      const res = await fetch("/api/body-metrics", { cache: "no-store" });
      if (!res.ok) return setError(res.status === 401 ? "Session expired — sign in again." : "Couldn't load your weigh-ins.");
      setRows(await res.json());
      setError(null);
    } catch {
      setError("Offline — weigh-ins need a connection.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  /** Re-read after any write, and tell Settings so its summary follows. */
  async function refresh() {
    await load();
    onChanged();
  }

  async function saveEdit(row: WeighIn, weightText: string, date: string) {
    const entered = Number(weightText);
    if (!Number.isFinite(entered) || entered <= 0) return setError("Enter a weight.");
    const res = await fetch(`/api/body-metrics/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightLb: toLb(entered, unit), date }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      // The conflict is NAMED, because "couldn't save" would leave you guessing
      // which day is occupied — and the honest answer is that the other
      // measurement is real and still there.
      if (j.error === "date_taken") {
        const w = j.existingWeightLb != null ? ` (${shown(j.existingWeightLb, unit)} ${unit})` : "";
        return setError(`There's already a weigh-in on ${longDate(j.date)}${w}. Delete or edit that one first — this won't replace it.`);
      }
      return setError(j.error ?? "Couldn't save that change.");
    }
    setEditingId(null);
    setError(null);
    await refresh();
  }

  async function remove(id: number) {
    const res = await fetch(`/api/body-metrics/${id}`, { method: "DELETE" });
    if (!res.ok) return setError("Couldn't delete that entry.");
    setConfirmId(null);
    setError(null);
    await refresh();
  }

  async function add() {
    const entered = Number(newWeight);
    if (!Number.isFinite(entered) || entered <= 0) return setError("Enter a weight.");
    const res = await fetch("/api/body-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: newDate, weightLb: toLb(entered, unit) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error ?? "Couldn't add that weigh-in.");
    }
    setNewWeight("");
    setNewDate(todayIso());
    setError(null);
    await refresh();
  }

  return (
    <Sheet
      title="Weigh-ins"
      subtitle="Newest first. Tap an entry to correct its weight or its date."
      onClose={onClose}
    >
      {error && <p className={styles.dataError} role="alert">{error}</p>}

      {rows == null ? (
        <p className={styles.footnote}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.footnote}>No weigh-ins yet. Add one below — back-date it if it&apos;s from an earlier day.</p>
      ) : (
        <ul className={styles.weighList}>
          {rows.map((r) => (
            <li key={r.id} className={styles.weighItem}>
              <button type="button" className={styles.weighRow} onClick={() => { setEditingId(editingId === r.id ? null : r.id); setConfirmId(null); }}>
                <span className={styles.weighWeight}>{shown(r.weightLb, unit)} {unit}</span>
                <span className={styles.weighDate}>{longDate(r.date)}</span>
                <span className={styles.weighChev} aria-hidden="true">›</span>
              </button>

              {editingId === r.id && (
                <EditRow row={r} unit={unit} onSave={(w, d) => saveEdit(r, w, d)} onAskDelete={() => setConfirmId(r.id)} />
              )}

              {confirmId === r.id && (
                // Two taps, never one — nothing depends on this row, but it is
                // still a measurement the owner took.
                <div className={styles.weighConfirm}>
                  <span>Delete {shown(r.weightLb, unit)} {unit} from {longDate(r.date)}?</span>
                  <button type="button" className={styles.weighDanger} onClick={() => remove(r.id)}>Delete</button>
                  <button type="button" className={styles.dataBtn} onClick={() => setConfirmId(null)}>Cancel</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={editors.sectionLabel}>Add a weigh-in</div>
      <div className={styles.aboutFtIn}>
        <NumberInput value={newWeight} onChange={setNewWeight} placeholder={unit} ariaLabel={`Weight in ${unit}`} className={styles.aboutInputSmall} />
        <input
          type="date"
          value={newDate}
          max={todayIso()}
          onChange={(e) => setNewDate(e.target.value)}
          aria-label="Date of this weigh-in"
          className={styles.aboutInput}
        />
        <button type="button" className={styles.dataBtn} onClick={add}>Add</button>
      </div>
      <p className={styles.footnote}>
        Adding on a date that already has an entry corrects that day. Moving an existing entry onto an occupied
        date is blocked instead — that would overwrite a real measurement.
      </p>
    </Sheet>
  );
}

function EditRow({
  row,
  unit,
  onSave,
  onAskDelete,
}: {
  row: WeighIn;
  unit: WeightUnit;
  onSave: (weight: string, date: string) => void;
  onAskDelete: () => void;
}) {
  // Seeded from the row in the ACTIVE unit; a toggle while open re-mounts this
  // via the key, so the box never shows a number in the wrong unit.
  const [weight, setWeight] = useState(String(shown(row.weightLb, unit)));
  const [date, setDate] = useState(row.date);
  return (
    <div className={styles.weighEdit} key={`${row.id}-${unit}`}>
      <NumberInput
        value={weight}
        onChange={setWeight}
        ariaLabel={`Weight in ${unit}`}
        className={styles.aboutInputSmall}
      />
      <input
        type="date"
        value={date}
        max={todayIso()}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Date"
        className={styles.aboutInput}
      />
      <button type="button" className={styles.dataBtn} onClick={() => onSave(weight, date)}>Save</button>
      <button type="button" className={styles.weighDanger} onClick={onAskDelete}>Delete</button>
    </div>
  );
}
