"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import styles from "./editors.module.css";

// Generic one-input sheet — create/rename a program, day, or block. The
// caller owns the API call; this owns the input + busy state.
export function NameSheet({
  title,
  label,
  initial = "",
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(name);
      onClose();
    } catch {
      setErr("Couldn't save — try again.");
      setBusy(false);
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{label}</span>
          <input className={styles.fieldInput} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </div>
        {err && <p className={styles.errText}>{err}</p>}
        <div className={styles.sheetActions} style={{ marginTop: 12 }}>
          <button type="submit" className={styles.primaryBtn} disabled={busy || value.trim() === ""}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
