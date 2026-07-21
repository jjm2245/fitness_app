"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import { SortableList, SortableRow } from "./SortableList";
import styles from "./editors.module.css";
import { api, type EditorDay } from "./types";

// Days reorder modal (phase 3.1) — replaces Move left / Move right. Drag the
// days into order, Save commits the whole ordering via the bulk endpoint.
export function DayOrganizeSheet({
  days,
  noun,
  programId,
  onChanged,
  onClose,
}: {
  days: EditorDay[];
  noun: "day" | "block";
  programId: number;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<number[]>(days.map((d) => d.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(days.map((d) => [d.id, d]));

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/programs/${programId}/days/reorder`, { method: "POST", body: JSON.stringify({ orderedIds: order }) });
      await onChanged();
      onClose();
    } catch {
      setErr("Couldn't save the order — try again.");
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Organize ${noun}s`} subtitle="Drag to reorder, then Save." onClose={onClose}>
      <div className={styles.rowsCard} style={{ marginTop: 0 }}>
        <SortableList ids={order.map(String)} onReorder={(ids) => setOrder(ids.map(Number))}>
          {order.map((id) => {
            const d = byId.get(id);
            if (!d) return null;
            return (
              <SortableRow key={id} id={String(id)}>
                {(grip) => (
                  <div className={styles.organizeRow}>
                    <span ref={grip.ref} {...grip.props} aria-label="Drag to reorder" className={styles.gripHandle}>⋮⋮</span>
                    <span className={styles.organizeName}>{d.name}</span>
                    <span className={styles.organizeCount}>{d.exercises.length}</span>
                  </div>
                )}
              </SortableRow>
            );
          })}
        </SortableList>
      </div>
      {err && <p className={styles.errText} style={{ marginTop: 8 }}>{err}</p>}
      <div className={styles.sheetActions} style={{ marginTop: 12 }}>
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={busy}>
          Save order
        </button>
      </div>
    </Sheet>
  );
}
