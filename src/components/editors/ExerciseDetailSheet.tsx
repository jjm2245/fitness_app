"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/session/Sheet";
import { MOVEMENT_PATTERNS, suggestMovementPattern } from "@/lib/movementPatterns";
import { ALL_LOG_FIELDS, defaultLogFields, hasFieldOverride, resolveLogFields, type LogField } from "@/lib/logFields";
import styles from "./editors.module.css";
import { api } from "./types";

// Chip labels for the eight-field vocabulary (Logs & targets editor).
const FIELD_LABELS: Record<LogField, string> = {
  weight: "Weight",
  reps: "Reps",
  effort: "Effort",
  duration: "Duration",
  distance: "Distance",
  level: "Level",
  speed: "Speed",
  incline: "Incline",
};

export interface ManagedExercise {
  id: string;
  name: string;
  source: string;
  canonicalName: string | null;
  movementPattern: string | null;
  untagged: boolean;
  unilateral: boolean;
  conditioningOnly: boolean;
  day: string | null;
  loadType: string;
  description: string | null;
  logFields?: unknown;
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

// The exercise edit sheet — ONE sheet, three variants by kind (exercise-section
// v2): Library (name read-only; Rename… is the deliberate act that creates a
// Renamed entry), Renamed (my name editable, library name always visible +
// one-tap revert), Custom (name editable; Collapse/Remove live ONLY here).
// All variants share Description, the Type toggle (still the router this
// round), Unilateral, a Tag row (pattern edits go through the same PATCH that
// auto-sets conditioning_only for `conditioning` — never around it), and a
// VIEW-ONLY Equipment row that navigates to the Equipment section.
export function ExerciseDetailSheet({
  ex,
  onChanged,
  onClose,
}: {
  ex: ManagedExercise;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(ex.name);
  const [renaming, setRenaming] = useState(false); // Library variant: Rename… reveals the input
  const [description, setDescription] = useState(ex.description ?? "");
  const [busy, setBusy] = useState(false);
  const [editingTag, setEditingTag] = useState(false);
  const [pattern, setPattern] = useState(ex.movementPattern ?? suggestMovementPattern(ex.name) ?? "");
  const [section, setSection] = useState<null | "collapse" | "remove">(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);

  // ── Logs & targets (Phase 1) ── the draft field set, initialized from the
  // resolver (override → name-default → type-default) and re-synced whenever
  // the saved config or the Type preset changes.
  const [draftFields, setDraftFields] = useState<LogField[]>(() => resolveLogFields(ex));
  // A pending save held behind the forward-only history warning (logged
  // exercises only). null = no confirm step open. The payload is what we'd
  // PATCH: an array, or null for Reset-to-default.
  const [pendingFields, setPendingFields] = useState<LogField[] | null | "closed">("closed");
  useEffect(() => {
    setDraftFields(resolveLogFields(ex));
    setPendingFields("closed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, ex.conditioningOnly, JSON.stringify(ex.logFields ?? null)]);

  const savedFields = resolveLogFields(ex);
  const fieldsDirty = JSON.stringify(draftFields) !== JSON.stringify(savedFields);
  const toggleField = (f: LogField) =>
    setDraftFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : ALL_LOG_FIELDS.filter((x) => cur.includes(x) || x === f)));

  // Effect boundary (no silent no-ops): this phase, StrengthCard is untouched
  // and CardioCard renders only metric cells — so a config whose full effect
  // can't materialize yet gets an explicit note. Strength-typed: reps removed
  // or any metric field added; cardio-typed: any strength field added.
  const boundaryNote = (() => {
    const metric = ["duration", "distance", "level", "speed", "incline"] as LogField[];
    const strengthGroup = ["weight", "reps", "effort"] as LogField[];
    if (!ex.conditioningOnly) {
      if (!draftFields.includes("reps") || draftFields.some((f) => metric.includes(f))) return true;
    } else if (draftFields.some((f) => strengthGroup.includes(f))) {
      return true;
    }
    return false;
  })();

  // Save path: logged history → forward-only warning first; else save directly.
  function requestFieldSave(payload: LogField[] | null) {
    if (ex.loggedCount > 0) setPendingFields(payload);
    else void patch({ logFields: payload });
  }
  function confirmFieldSave() {
    const payload = pendingFields === "closed" ? null : pendingFields;
    setPendingFields("closed");
    void patch({ logFields: payload });
  }

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

  // Kind line under the title — replaces the old badge pair.
  const kindLine =
    ex.kind === "library_name"
      ? "Library exercise"
      : ex.kind === "named_on_ref"
      ? `Renamed · library: ${ex.canonicalName} · ${ex.loggedCount} logged`
      : "Custom · yours";

  const patternLabel = ex.movementPattern
    ? MOVEMENT_PATTERNS.find((p) => p.value === ex.movementPattern)?.label ?? ex.movementPattern
    : null;

  const nameDirty = name.trim() !== "" && name.trim() !== ex.name;

  return (
    <Sheet title={ex.name} subtitle={<span className={styles.sheetRowMuted}>{kindLine}</span>} onClose={onClose}>
      {/* ── Name (variant-specific) ── */}
      {ex.kind === "library_name" && !renaming ? (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <div className={styles.fieldRow}>
            <span className={styles.readonlyName}>{ex.name}</span>
            <button type="button" className={styles.quietBtn} onClick={() => setRenaming(true)}>
              Rename…
            </button>
          </div>
          <span className={styles.fieldNote}>Renaming keeps the library reference — your name shows everywhere, the library name stays underneath.</span>
        </div>
      ) : (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <div className={styles.fieldRow}>
            <input className={styles.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
            <button
              type="button"
              className={styles.quietBtn}
              disabled={busy || !nameDirty}
              onClick={() => { patch({ name: name.trim() }); setRenaming(false); }}
            >
              Save
            </button>
            {/* One-tap way out of the edit state: discards the draft, saves
                nothing. Always shown mid-rename (library); shown once the draft
                differs elsewhere — never stranded in an edit state. */}
            {(renaming || nameDirty) && (
              <button
                type="button"
                className={styles.quietBtn}
                disabled={busy}
                onClick={() => { setName(ex.name); setRenaming(false); }}
              >
                Cancel
              </button>
            )}
          </div>
          {ex.kind === "named_on_ref" && ex.canonicalName && (
            <>
              <span className={styles.fieldNote}>Library name: {ex.canonicalName}</span>
              <button
                type="button"
                className={styles.quietBtn}
                style={{ marginTop: 6, alignSelf: "flex-start" }}
                disabled={busy}
                onClick={() => { setName(ex.canonicalName!); patch({ name: ex.canonicalName }); }}
              >
                Use library name
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Description (all variants) ── */}
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

      {/* ── Type — demoted to a preset-picker in the UI framing (Phase 1).
             Routing behavior is UNCHANGED: conditioning_only still routes the
             session cards until Phase 2; only the words changed. ── */}
      <div className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Type (preset)</span>
        <div className={styles.movePair}>
          <button
            type="button"
            className={!ex.conditioningOnly ? styles.toggleActive : styles.toggleBtn}
            disabled={busy}
            onClick={() => { if (ex.conditioningOnly) patch({ conditioningOnly: false }); }}
          >
            Strength
          </button>
          <button
            type="button"
            className={ex.conditioningOnly ? styles.toggleActive : styles.toggleBtn}
            disabled={busy}
            onClick={() => { if (!ex.conditioningOnly) patch({ conditioningOnly: true }); }}
          >
            Cardio
          </button>
        </div>
        <span className={styles.fieldNote}>
          Sets the default fields below — edits there override per-exercise.
        </span>
      </div>

      {/* ── Tag (movement pattern) — edits go through the same PATCH path that
             auto-sets conditioning_only for the conditioning pattern ── */}
      <div className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Tag</span>
        {!editingTag ? (
          <div className={styles.fieldRow}>
            <span className={styles.readonlyName}>
              {patternLabel ?? <span className={styles.sheetRowMuted}>untagged</span>}
            </span>
            <button type="button" className={styles.quietBtn} onClick={() => setEditingTag(true)}>
              Change…
            </button>
          </div>
        ) : (
          <div className={styles.fieldRow}>
            <select className={styles.fieldInput} value={pattern} onChange={(e) => setPattern(e.target.value)}>
              <option value="">Choose a pattern…</option>
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <button
              type="button"
              className={styles.quietBtn}
              disabled={busy || !pattern || pattern === ex.movementPattern}
              onClick={() => { patch({ movementPattern: pattern }); setEditingTag(false); }}
            >
              Save
            </button>
            <button
              type="button"
              className={styles.quietBtn}
              disabled={busy}
              onClick={() => { setEditingTag(false); setPattern(ex.movementPattern ?? suggestMovementPattern(ex.name) ?? ""); }}
            >
              Cancel
            </button>
          </div>
        )}
        <span className={styles.fieldNote}>The pattern makes it substitutable; tagging Conditioning also marks it cardio.</span>
      </div>

      {/* ── Logs & targets (Phase 1) — the per-exercise field config. Chips
             pre-filled from the resolver; Reset writes NULL (inherit, so future
             default improvements flow through). ── */}
      <div className={styles.field} style={{ marginTop: 12 }}>
        <span className={styles.fieldLabel}>Logs &amp; targets</span>
        <div className={styles.fieldChips}>
          {ALL_LOG_FIELDS.map((f) => (
            <button
              key={f}
              type="button"
              className={draftFields.includes(f) ? styles.fieldChipOn : styles.fieldChip}
              onClick={() => toggleField(f)}
              aria-pressed={draftFields.includes(f)}
            >
              {FIELD_LABELS[f]}
            </button>
          ))}
        </div>
        {draftFields.length === 0 && (
          <span className={styles.errText}>At least one field is required.</span>
        )}
        {boundaryNote && (
          <span className={styles.fieldNote}>Takes effect when mixed logging ships (next update).</span>
        )}
        {hasFieldOverride(ex) && (
          <span className={styles.fieldNote}>
            Edited — default for {ex.conditioningOnly ? "Cardio" : "Strength"} is{" "}
            {defaultLogFields(ex).map((f) => FIELD_LABELS[f]).join(" · ")} ·{" "}
            <button type="button" className={styles.linkRemove} style={{ minHeight: 0, display: "inline" }} disabled={busy} onClick={() => requestFieldSave(null)}>
              Reset to default
            </button>
          </span>
        )}
        {(fieldsDirty || pendingFields !== "closed") && (
          <div className={styles.fieldRow} style={{ marginTop: 6 }}>
            <button
              type="button"
              className={styles.quietBtn}
              disabled={busy || draftFields.length === 0 || !fieldsDirty}
              onClick={() => requestFieldSave(draftFields)}
            >
              Save fields
            </button>
            <button type="button" className={styles.quietBtn} disabled={busy} onClick={() => { setDraftFields(savedFields); setPendingFields("closed"); }}>
              Cancel
            </button>
          </div>
        )}
        {pendingFields !== "closed" && (
          <div className={styles.warnBox} style={{ marginTop: 8 }}>
            <p>
              <strong>{ex.name}</strong> has <strong>{ex.loggedCount} logged {ex.loggedCount === 1 ? "entry" : "entries"}</strong>.
              Past sessions keep their data exactly as logged — only future sessions use the new fields, and progression
              will note the change.
            </p>
            <div className={styles.sheetActions} style={{ marginTop: 10 }}>
              <button type="button" className={styles.primaryBtn} disabled={busy} onClick={confirmFieldSave}>
                Save — applies going forward
              </button>
              <button type="button" className={styles.quietBtn} disabled={busy} onClick={() => setPendingFields("closed")}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {/* Cross-link: the fields govern what's logged/targeted, but the target
            VALUES live per-day in Program/Blocks — mirrors the target sheet's
            "Edit exercise →" link in the other direction. */}
        <span className={styles.fieldNote} style={{ marginTop: 6 }}>
          Target values (sets, reps, duration…) are set per day in{" "}
          <button
            type="button"
            className={styles.linkRemove}
            style={{ minHeight: 0, display: "inline" }}
            onClick={() => { onClose(); router.push("/program"); }}
          >
            Program or Blocks
          </button>.
        </span>
      </div>

      {/* ── Unilateral (unchanged) ── */}
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

      {/* ── Equipment (view-only; managing units lives in the Equipment section) ── */}
      <EquipmentView exerciseId={ex.id} onManage={() => { onClose(); router.push("/equipment"); }} />

      {/* ── Custom-only: Collapse + Remove ── */}
      {ex.kind === "custom" && (
        <>
          <div className={styles.sectionLabel}>More</div>
          <div className={styles.sheetList}>
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
        </>
      )}
    </Sheet>
  );
}

// View-only unit list + a nav row to the Equipment section (unit add/edit was
// removed from this sheet — that's the Equipment section's job).
function EquipmentView({ exerciseId, onManage }: { exerciseId: string; onManage: () => void }) {
  const [rows, setRows] = useState<ExerciseEquipment[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}/equipment`);
    if (res.ok) setRows(await res.json());
    setLoaded(true);
  }, [exerciseId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.field} style={{ marginTop: 12 }}>
      <span className={styles.fieldLabel}>Equipment</span>
      {!loaded ? (
        <span className={styles.sheetRowMuted}>Loading…</span>
      ) : rows.length === 0 ? (
        <span className={styles.fieldNote}>No units yet — they appear automatically the first time you log with one.</span>
      ) : (
        <span className={styles.fieldNote}>
          {rows.map((m) => m.label + (m.loggedCount > 0 ? ` (${m.loggedCount} logged)` : "")).join(" · ")}
        </span>
      )}
      <button type="button" className={styles.quietBtn} style={{ marginTop: 6, alignSelf: "flex-start" }} onClick={onManage}>
        Manage in Equipment →
      </button>
    </div>
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
