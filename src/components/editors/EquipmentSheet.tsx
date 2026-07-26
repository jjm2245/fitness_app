"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import styles from "./editors.module.css";
import { UnitFormFields, emptyUnitDraft, EQUIPMENT_UNIT_TYPES, type UnitDraft } from "./UnitFormFields";
import { parseStackMarking, resolveWeightUnit } from "@/lib/stack";
import { formatForUnit } from "@/lib/units";
import { useWeightUnit } from "@/lib/useUnit";

// "Used by" — the unit's exercise links, editable. A unit is a physical
// machine, and one machine can serve any number of exercises (a rear-delt/pec
// deck does flyes AND butterfly; a Precor combo does leg extension AND curl) —
// the schema has always been many-to-many, so this is the surface for it.
//
// Linking and unlinking NEVER touch logged history: a set's lane is its
// equipment_id, which these rows don't write. Unlinking only stops offering the
// unit for that exercise going forward.
function UsedBy({ unit, onChanged }: { unit: EquipmentUnit; onChanged: () => Promise<void> }) {
  const [links, setLinks] = useState(unit.exercises);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setLinks(unit.exercises), [unit.exercises]);

  // Debounced search, same 2-char / 220 ms contract as ExerciseSearch.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/exercises/search?q=${encodeURIComponent(q.trim())}`);
      setResults(res.ok ? await res.json() : []);
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  async function link(ex: { id: string; name: string }) {
    if (busy || links.some((l) => l.exerciseId === ex.id)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(ex.id)}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: unit.id, label: unit.label }),
      });
      if (res.ok) {
        setLinks((cur) => [...cur, { exerciseId: ex.id, name: ex.name }]);
        setQ("");
        setResults([]);
        setAdding(false);
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function unlink(exerciseId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/exercises/${encodeURIComponent(exerciseId)}/equipment/${encodeURIComponent(unit.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setLinks((cur) => cur.filter((l) => l.exerciseId !== exerciseId));
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  const candidates = results.filter((r) => !links.some((l) => l.exerciseId === r.id));

  return (
    <>
      <div className={styles.sectionLabel}>Used by</div>
      {links.length === 0 ? (
        <p className={styles.fieldNote}>
          Not linked to any exercise yet — a link is added automatically the first time you log with this unit.
        </p>
      ) : (
        <div className={styles.sheetList}>
          {links.map((l) => (
            <div key={l.exerciseId} className={styles.pickRow}>
              <span className={styles.pickMain}>
                <span className={styles.pickName}>{l.name}</span>
              </span>
              <button type="button" className={styles.quietBtn} onClick={() => void unlink(l.exerciseId)} disabled={busy}>
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}
      <p className={styles.fieldNote} style={{ marginTop: 6 }}>
        Unlinking only stops offering this unit for that exercise. Sets you already logged on it keep their history and
        stay in this unit&rsquo;s lane.
      </p>

      {!adding ? (
        <button type="button" className={styles.quietBtn} style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
          ＋ Link an exercise…
        </button>
      ) : (
        <div style={{ marginTop: 8 }}>
          <input
            className={styles.fieldInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search exercises…"
            type="search"
            autoFocus
          />
          {q.trim().length >= 2 && (
            <div className={styles.sheetList} style={{ marginTop: 6 }}>
              {candidates.length === 0 ? (
                <p className={styles.fieldNote}>No matches.</p>
              ) : (
                candidates.slice(0, 8).map((r) => (
                  <button key={r.id} type="button" className={styles.pickRow} onClick={() => void link(r)} disabled={busy}>
                    <span className={styles.pickMain}>
                      <span className={styles.pickName}>{r.name}</span>
                    </span>
                    <span className={styles.sheetRowMuted}>＋</span>
                  </button>
                ))
              )}
            </div>
          )}
          <button type="button" className={styles.quietBtn} style={{ marginTop: 6 }} onClick={() => { setAdding(false); setQ(""); }}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}


interface CorrectionReport {
  label: string;
  builtInWeight: number | null;
  stackUnit: string | null;
  counts: { withOffset: number; nullOffset: number };
  disagreements: Array<{ offset: number; count: number; firstDate: string | null; lastDate: string | null }>;
  preview: null | {
    offset: number;
    withOffset: { changes: RowChange[]; firstDate: string | null; lastDate: string | null; unchanged: number };
    nullOffset: { changes: RowChange[]; firstDate: string | null; lastDate: string | null; unchanged: number };
  };
}
interface RowChange {
  id: number; date: string; exercise: string; reps: number;
  loadBefore: number; loadAfter: number; loadEntered: number;
  offsetBefore: number | null; offsetAfter: number | null;
}

// Retroactive built-in correction.
//
// A machine's carriage has always weighed what it weighs, so a wrong built-in is
// a RECORDING ERROR and every affected row was always the corrected number —
// which is why this reaches backward where field-config changes don't.
//
// Detection is always-on and read-only, because the disagreement this exists for
// PRE-DATES any change: rows logged against a type default before the unit
// existed, then attributed to it. Nothing would have fired a change-triggered
// check. The correction itself is never automatic and never silent.
function BuiltInCorrection({ unit, onChanged }: { unit: EquipmentUnit; onChanged: () => Promise<void> }) {
  const [report, setReport] = useState<CorrectionReport | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [includeNull, setIncludeNull] = useState(false); // a DIFFERENT assertion — opt in
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [wUnit] = useWeightUnit();

  const refresh = useCallback(async (offset?: number) => {
    const q = offset != null ? `?offset=${offset}` : "";
    const res = await fetch(`/api/equipment/${encodeURIComponent(unit.id)}/builtin-correction${q}`);
    if (res.ok) setReport(await res.json());
  }, [unit.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The unit's own markings govern, exactly as they do on the form, the list
  // badge and the session card — a confirm dialog showing before/after in a
  // different unit would be the one place on this machine speaking another
  // language.
  const u = resolveWeightUnit(parseStackMarking(report?.stackUnit ?? unit.stackUnit), wUnit);
  const show = (lb: number) => `${formatForUnit(String(lb), u, "weight")} ${u}`;

  if (!report) return null;
  const recorded = report.builtInWeight;
  const preview = report.preview;

  async function openPreview(offset: number) {
    setTarget(offset);
    setDone(null);
    await refresh(offset);
  }
  function cancel() {
    // Cancel writes NOTHING — it only drops the local preview.
    setTarget(null);
    void refresh();
  }
  async function confirm() {
    if (target == null || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(unit.id)}/builtin-correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset: target, includeNullOffset: includeNull }),
      });
      if (res.ok) {
        const r = await res.json();
        setDone(`Corrected ${r.updated + r.nullUpdated} set${r.updated + r.nullUpdated === 1 ? "" : "s"}.`);
        setTarget(null);
        await refresh();
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  const sample = (changes: RowChange[]) => changes.slice(0, 4);

  return (
    <>
      <div className={styles.sectionLabel}>Built-in history</div>

      {done && <p className={styles.fieldNote}>✓ {done}</p>}

      {/* Always-on detection. */}
      {report.disagreements.length === 0 && target == null && (
        <p className={styles.fieldNote}>
          {report.counts.withOffset === 0
            ? "No logged sets on this unit carry a built-in."
            : `All ${report.counts.withOffset} logged set${report.counts.withOffset === 1 ? "" : "s"} with a built-in match this unit's ${recorded != null ? show(recorded) : "recorded value"}.`}
        </p>
      )}
      {report.disagreements.map((d) => (
        <div key={d.offset} className={styles.warnBox} style={{ marginTop: 6 }}>
          <p>
            <strong>{d.count} set{d.count === 1 ? "" : "s"}</strong> on this unit use a built-in of {show(d.offset)};
            this unit records {recorded != null ? show(recorded) : "nothing"}
            {d.firstDate ? ` (${d.firstDate}${d.lastDate && d.lastDate !== d.firstDate ? ` – ${d.lastDate}` : ""})` : ""}.
          </p>
          {recorded != null && target == null && (
            <button type="button" className={styles.quietBtn} style={{ marginTop: 8 }} onClick={() => void openPreview(recorded)}>
              Align to {show(recorded)}…
            </button>
          )}
        </div>
      ))}

      {/* Correcting to the recorded value is always offered, so a built-in that
          was EDITED (creating a fresh disagreement) uses the same one flow. */}
      {recorded != null && target == null && report.counts.withOffset > 0 && report.disagreements.length === 0 && (
        <button type="button" className={styles.quietBtn} style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => void openPreview(recorded)}>
          Re-apply {show(recorded)} to logged sets…
        </button>
      )}

      {/* Preview → Confirm / Cancel. */}
      {preview && target != null && (
        <div className={styles.formGroup}>
          <span className={styles.fieldLabel}>Preview — correcting to {show(preview.offset)}</span>
          {preview.withOffset.changes.length === 0 ? (
            <p className={styles.fieldNote}>No sets with a built-in would change.</p>
          ) : (
            <>
              <p className={styles.fieldNote}>
                <strong>{preview.withOffset.changes.length} set{preview.withOffset.changes.length === 1 ? "" : "s"}</strong> change
                {preview.withOffset.firstDate ? `, ${preview.withOffset.firstDate}${preview.withOffset.lastDate !== preview.withOffset.firstDate ? ` – ${preview.withOffset.lastDate}` : ""}` : ""}
                {preview.withOffset.unchanged > 0 ? ` · ${preview.withOffset.unchanged} already correct` : ""}.
              </p>
              <div className={styles.sheetList}>
                {sample(preview.withOffset.changes).map((c) => (
                  <p key={c.id} className={styles.fieldNote}>
                    {c.date} · {c.exercise} — {show(c.loadBefore)} → <strong>{show(c.loadAfter)}</strong> × {c.reps}
                  </p>
                ))}
                {preview.withOffset.changes.length > 4 && (
                  <p className={styles.fieldNote}>…and {preview.withOffset.changes.length - 4} more.</p>
                )}
              </div>
              <p className={styles.fieldNote}>
                What you put on the machine is unchanged — only the carriage weight added to it.
              </p>
            </>
          )}

          {/* A separate, defaulted-off assertion. */}
          {preview.nullOffset.changes.length > 0 && (
            <label className={styles.field} style={{ marginTop: 8 }}>
              <span className={styles.fieldNote}>
                <input type="checkbox" checked={includeNull} onChange={(e) => setIncludeNull(e.target.checked)} />{" "}
                Also apply to {preview.nullOffset.changes.length} set
                {preview.nullOffset.changes.length === 1 ? "" : "s"} on this unit logged <em>without</em> a built-in.
                This claims you were always lifting {show(preview.offset)} more than recorded on those sets — a different
                statement from correcting one, so it is off by default.
              </span>
            </label>
          )}

          <p className={styles.fieldNote} style={{ marginTop: 6 }}>
            This unit&rsquo;s &ldquo;last …&rdquo; references and progression suggestions will shift to match.
          </p>

          <div className={styles.sheetActions} style={{ marginTop: 10 }}>
            <button type="button" className={styles.primaryBtn} onClick={() => void confirm()} disabled={busy}>
              {busy ? "Correcting…" : "Confirm correction"}
            </button>
            <button type="button" className={styles.quietBtn} onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export interface EquipmentUnit {
  id: string;
  label: string;
  gym: string | null;
  brand: string | null;
  model: string | null;
  builtInWeight: string | null;
  equipmentType: string | null;
  pulleyRatioKind: string;
  plateIncrement: string | null;
  addOnWeight: string | null;
  stackMax: string | null;
  stackUnit: string | null;
  notes: string | null;
  exercises: Array<{ exerciseId: string; name: string }>;
  loggedCount: number;
  lastUsed?: string | null; // most recent session date this unit was logged on
  loggedLoads?: number[]; // distinct loads on this unit — the increment hint
}

export { EQUIPMENT_UNIT_TYPES };

function toDraft(m?: EquipmentUnit): UnitDraft {
  return emptyUnitDraft({
    label: m?.label ?? "",
    gym: m?.gym ?? "",
    brand: m?.brand ?? "",
    model: m?.model ?? "",
    // Stored null stays EMPTY (unknown) — never rendered as 0.
    builtInWeight: m?.builtInWeight != null ? String(Number(m.builtInWeight)) : "",
    equipmentType: m?.equipmentType ?? "",
    pulleyRatioKind: m?.pulleyRatioKind ?? "unknown",
    plateIncrement: m?.plateIncrement != null ? String(Number(m.plateIncrement)) : "",
    addOnWeight: m?.addOnWeight != null ? String(Number(m.addOnWeight)) : "",
    stackMax: m?.stackMax != null ? String(Number(m.stackMax)) : "",
    stackUnit: m?.stackUnit === "kg" || m?.stackUnit === "lb" ? m.stackUnit : "",
    notes: m?.notes ?? "",
  });
}

// Equipment detail sheet — all fields editable, used-by list, merge (history-
// moves copy kept), history-safe delete. Doubles as the Add sheet for a new
// standalone unit: POST /api/equipment (label/built-in/notes) then PATCH the
// structured fields — the exercise-scoped new-unit sheet doesn't fit here
// (no exercise context), so the same field layout is reused via these routes.
export function EquipmentSheet({
  unit,
  allUnits,
  onChanged,
  onClose,
}: {
  unit: EquipmentUnit | null; // null = add mode
  allUnits: EquipmentUnit[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const isNew = unit == null;
  // Gyms already in use — the dropdown's options, so a typo can't mint a
  // spelling variant of a gym that already exists.
  const knownGyms = useMemo(
    () => [...new Set(allUnits.map((u) => u.gym).filter((g): g is string => !!g && g.trim() !== ""))].sort(),
    [allUnits]
  );
  const loggedLoads = unit?.loggedLoads ?? [];
  const [d, setD] = useState<UnitDraft>(toDraft(unit ?? undefined));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; existingId?: string } | null>(null);
  const [section, setSection] = useState<null | "merge" | "delete">(null);
  const set = (patch: Partial<UnitDraft>) => setD((cur) => ({ ...cur, ...patch }));
  // ── merge target picking ──
  const [mergeQ, setMergeQ] = useState("");
  const [mergeAllTypes, setMergeAllTypes] = useState(false);

  const structured = {
    gym: d.gym,
    brand: d.brand,
    model: d.model,
    equipmentType: d.equipmentType,
    pulleyRatioKind: d.pulleyRatioKind,
    notes: d.notes,
    builtInWeight: d.builtInWeight.trim() === "" ? null : Number(d.builtInWeight),
    plateIncrement: d.plateIncrement.trim() === "" ? null : Number(d.plateIncrement),
    addOnWeight: d.addOnWeight.trim() === "" ? null : Number(d.addOnWeight),
    stackMax: d.stackMax.trim() === "" ? null : Number(d.stackMax),
    stackUnit: d.stackUnit === "kg" || d.stackUnit === "lb" ? d.stackUnit : null,
  };

  async function save() {
    if (!d.label.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (isNew) {
        const id = crypto.randomUUID();
        const post = await fetch("/api/equipment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, label: d.label.trim(), builtInWeight: structured.builtInWeight, notes: d.notes || null }),
        });
        if (!post.ok) {
          setErr({ message: "Couldn't create the unit." });
          return;
        }
        // Structured fields (type/pulley/gym/brand/model) land via PATCH.
        await fetch(`/api/equipment/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: d.label.trim(), ...structured }),
        });
      } else {
        const res = await fetch(`/api/equipment/${encodeURIComponent(unit!.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: d.label.trim(), ...structured }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setErr({ message: body?.message ?? "Couldn't save.", existingId: body?.existingId });
          return;
        }
      }
      await onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  // Plausible targets: same type by default (built-in/pulley semantics don't
  // transfer across types), with search + an escape hatch — a MIS-TYPED unit is
  // itself a reason to merge, so "show all types" must stay reachable. A unit
  // with no type set can't filter meaningfully, so it shows everything.
  const mergeTargets = useMemo(() => {
    if (isNew) return [];
    const needle = mergeQ.trim().toLowerCase();
    return allUnits
      .filter((t) => t.id !== unit!.id)
      .filter((t) => (mergeAllTypes || !unit!.equipmentType ? true : t.equipmentType === unit!.equipmentType))
      .filter((t) =>
        !needle
          ? true
          : [t.label, t.gym, t.brand, t.model].filter(Boolean).some((f) => f!.toLowerCase().includes(needle))
      );
  }, [allUnits, unit, isNew, mergeQ, mergeAllTypes]);

  async function merge(targetId: string) {
    if (isNew || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(unit!.id)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (res.ok) {
        await onChanged();
        onClose();
      } else {
        const body = await res.json().catch(() => null);
        setErr({ message: body?.message ?? "Merge failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (isNew || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(unit!.id)}`, { method: "DELETE" });
      if (res.ok) {
        await onChanged();
        onClose();
      } else {
        const body = await res.json().catch(() => null);
        setErr({ message: body?.message ?? "Couldn't delete." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={isNew ? "Add equipment unit" : unit!.label}
      subtitle={!isNew && unit!.loggedCount > 0 ? `${unit!.loggedCount} logged set${unit!.loggedCount === 1 ? "" : "s"} reference this unit` : undefined}
      onClose={onClose}
    >
      <UnitFormFields
        draft={d}
        onChange={set}
        showType
        autoFocusLabel={isNew}
        knownGyms={knownGyms}
        loggedLoads={loggedLoads}
      />

      {err && (
        <div className={styles.warnBox} style={{ marginTop: 10 }}>
          <p className={styles.errText}>{err.message}</p>
          {err.existingId && (
            <button type="button" className={styles.quietBtn} style={{ marginTop: 8 }} onClick={() => merge(err.existingId!)} disabled={busy}>
              Merge into the existing one
            </button>
          )}
        </div>
      )}

      <div className={styles.sheetActions} style={{ marginTop: 12 }}>
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={busy || d.label.trim() === ""}>
          {isNew ? "Add unit" : "Save changes"}
        </button>
      </div>

      {!isNew && (
        <UsedBy unit={unit!} onChanged={onChanged} />
      )}

      {!isNew && (
        <BuiltInCorrection unit={unit!} onChanged={onChanged} />
      )}

      {!isNew && (
        <>
          <div className={styles.sectionLabel}>More</div>
          <div className={styles.sheetList}>
            <button type="button" className={styles.sheetRow} onClick={() => setSection(section === "merge" ? null : "merge")}>
              <span style={{ flex: 1 }}>Merge into…</span>
              <span className={styles.sheetRowMuted}>{section === "merge" ? "Close" : ""}</span>
            </button>
            {section === "merge" && (
              // Standard sheet surface — merge is history-SAFE by design, so
              // amber is reserved for the genuine delete guard.
              <div style={{ marginTop: 8 }}>
                <p className={styles.fieldNote} style={{ marginBottom: 8 }}>
                  Merge <strong>{unit!.label}</strong> into another unit — its {unit!.loggedCount} logged set
                  {unit!.loggedCount === 1 ? "" : "s"} and exercise links move over (history moves, never orphans), then
                  this entry is deleted.
                </p>
                <input
                  className={styles.fieldInput}
                  value={mergeQ}
                  onChange={(e) => setMergeQ(e.target.value)}
                  placeholder="Search label / gym / manufacturer…"
                  type="search"
                />
                <div className={styles.fieldRow} style={{ marginTop: 8, alignItems: "center", justifyContent: "space-between" }}>
                  <span className={styles.fieldNote}>
                    {mergeAllTypes || !unit!.equipmentType
                      ? "Showing all types"
                      : `Showing ${unit!.equipmentType} units`}
                  </span>
                  {unit!.equipmentType && (
                    <button type="button" className={styles.quietBtn} onClick={() => setMergeAllTypes((v) => !v)}>
                      {mergeAllTypes ? "Same type only" : "Show all types"}
                    </button>
                  )}
                </div>
                <div className={styles.sheetList} style={{ marginTop: 4 }}>
                  {mergeTargets.map((t) => (
                    <button key={t.id} type="button" className={styles.pickRow} onClick={() => merge(t.id)} disabled={busy}>
                      <span className={styles.pickMain}>
                        <span className={styles.pickName}>{t.label}</span>
                        <span className={styles.pickSub}>
                          {[
                            t.equipmentType,
                            [t.gym, t.brand].filter(Boolean).join(" · ") || null,
                            t.exercises.length > 0 ? `used by ${t.exercises.length}` : null,
                            t.loggedCount > 0 ? `${t.loggedCount} logged` : null,
                          ].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className={styles.sheetRowMuted}>→</span>
                    </button>
                  ))}
                  {mergeTargets.length === 0 && (
                    <p className={styles.fieldNote}>
                      {allUnits.length <= 1
                        ? "No other units to merge into."
                        : mergeQ.trim()
                        ? "No matches."
                        : "No other units of this type — try “Show all types”."}
                    </p>
                  )}
                </div>
              </div>
            )}

            <button type="button" className={styles.sheetRow} onClick={() => { setSection(section === "delete" ? null : "delete"); setErr(null); }}>
              <span style={{ flex: 1, color: "var(--danger)" }}>Delete unit</span>
              <span className={styles.sheetRowMuted}>{section === "delete" ? "Close" : ""}</span>
            </button>
            {section === "delete" && (
              <div className={styles.warnBox} style={{ marginTop: 8 }}>
                {unit!.loggedCount > 0 ? (
                  <p>
                    Blocked: <strong>{unit!.loggedCount} logged set{unit!.loggedCount === 1 ? "" : "s"}</strong> reference{" "}
                    <strong>{unit!.label}</strong>. Deleting would orphan that history — use <em>Merge into…</em> to move it
                    onto another unit first.
                  </p>
                ) : (
                  <>
                    <p>Delete <strong>{unit!.label}</strong>? This can&rsquo;t be undone.</p>
                    <div className={styles.sheetActions} style={{ marginTop: 10 }}>
                      <button type="button" className={styles.dangerFill} style={{ flex: 1 }} onClick={remove} disabled={busy}>
                        Delete unit
                      </button>
                      <button type="button" className={styles.quietBtn} onClick={() => setSection(null)}>Keep</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
