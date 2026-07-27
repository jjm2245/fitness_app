"use client";

import { useState } from "react";
import styles from "./settings.module.css";
import editors from "@/components/editors/editors.module.css";
import { exportFilename } from "@/lib/exportCsv";

// "Your data" — the way out.
//
// Neon's backups protect the DATABASE; they don't give the owner a file they
// can open, diff, or carry to another app. This does. Everything happens at
// tap time: the server SELECTs, the browser saves. No export is ever stored.

/** Hand a Blob to the browser as a download and clean up the object URL. */
function saveFile(contents: BlobPart, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke on the next tick — revoking synchronously can race the download
  // in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The per-DEVICE settings, which live in localStorage and therefore never
 * appear in a server-side dump.
 *
 * They're small and they're genuinely yours (your unit preference, the
 * per-exercise equipment memory, the offset confirmations), so a snapshot that
 * silently dropped them would be less complete than it claims to be. Captured
 * in the browser and merged into the file the browser writes.
 */
function deviceSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof window === "undefined") return out;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k == null) continue;
    if (k.startsWith("fitness-app:") || k === "entry-unit-weight" || k === "entry-unit-distance") {
      out[k] = localStorage.getItem(k) ?? "";
    }
  }
  return out;
}

type Status = { kind: "idle" } | { kind: "working"; what: string } | { kind: "done"; text: string } | { kind: "error"; text: string };

export function DataExport() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function fail(res: Response): Promise<string> {
    if (res.status === 401) return "Session expired — sign in again, then retry.";
    if (res.status === 503) return "The server is mid-deploy (schema behind). Try again shortly.";
    return `Export failed (${res.status}).`;
  }

  async function exportJson() {
    setStatus({ kind: "working", what: "Building snapshot…" });
    try {
      const res = await fetch("/api/export", { cache: "no-store" });
      if (!res.ok) return setStatus({ kind: "error", text: await fail(res) });
      const payload = await res.json();
      // The one thing the server can't see. Labelled, not blended in, so a
      // reader knows it came from this browser and not the database.
      payload.device = { capturedInBrowser: true, localStorage: deviceSnapshot() };
      const name = exportFilename("export", "json");
      saveFile(JSON.stringify(payload, null, 2), name, "application/json");
      const c = payload.counts ?? {};
      setStatus({
        kind: "done",
        // Echo the numbers back so the file can be checked without opening it.
        text: `${name} — ${c.set_logs ?? 0} sets · ${c.workout_logs ?? 0} sessions · ${c.equipment ?? 0} machines · ${c.exercises ?? 0} exercises`,
      });
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach the server. An export needs a connection — it reads the database, not this device." });
    }
  }

  async function exportCsv() {
    setStatus({ kind: "working", what: "Building spreadsheet…" });
    try {
      const res = await fetch("/api/export?format=csv", { cache: "no-store" });
      if (!res.ok) return setStatus({ kind: "error", text: await fail(res) });
      const text = await res.text();
      const name = exportFilename("sets", "csv");
      saveFile(text, name, "text/csv;charset=utf-8");
      // Header row doesn't count as a set.
      const rows = Math.max(0, text.trimEnd().split("\r\n").length - 1);
      setStatus({ kind: "done", text: `${name} — ${rows} sets` });
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach the server. An export needs a connection — it reads the database, not this device." });
    }
  }

  const busy = status.kind === "working";

  return (
    <>
      <div className={editors.sectionLabel}>Your data</div>

      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={editors.fieldLabel}>Complete backup</span>
          <span className={editors.fieldNote}>
            Every session, set, exercise, machine and program — as JSON. Enough to rebuild the database.
          </span>
        </div>
        <button type="button" className={`${styles.dataBtn} ${styles.rowControl}`} onClick={exportJson} disabled={busy}>
          Export JSON
        </button>
      </div>

      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={editors.fieldLabel}>Sets spreadsheet</span>
          <span className={editors.fieldNote}>
            Every logged set, one row each, with exercise and machine names spelled out — as CSV.
          </span>
        </div>
        <button type="button" className={`${styles.dataBtn} ${styles.rowControl}`} onClick={exportCsv} disabled={busy}>
          Export CSV
        </button>
      </div>

      {status.kind !== "idle" && (
        <p className={status.kind === "error" ? styles.dataError : styles.dataStatus} role="status">
          {status.kind === "working" ? status.what : status.text}
        </p>
      )}

      <p className={styles.footnote}>
        Built when you tap and handed straight to your browser — no copy is kept on the server. Reading only: an export
        never changes anything.
      </p>
    </>
  );
}
