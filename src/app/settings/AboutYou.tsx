"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./settings.module.css";
import editors from "@/components/editors/editors.module.css";
import { useWeightUnit } from "@/lib/useUnit";
import {
  cmToIn,
  ftInToIn,
  inToCm,
  inToFtIn,
  kgToLb,
  lbToKg,
  displayLb,
  formatHeight,
} from "@/lib/units";

// "About you" — facts about the owner, not about training.
//
// Every field here is CONTEXT today: nothing in the app reads any of it. The
// copy says so outright, because a settings screen that implies its fields do
// work when they don't is worse than an empty one.
//
// Two rules carried in from the rest of the app:
//   · Storage is canonical — pounds and inches — and the global weight
//     preference governs display for BOTH. A body measurement has no machine
//     marking to respect, and nobody thinks in pounds and centimetres at once.
//   · Blank means NOT RECORDED. Clearing a field writes NULL, never 0.

interface ProfileData {
  dob: string | null;
  sex: string | null;
  heightIn: number | null;
  trainingYears: number | null;
}
interface Latest {
  date: string;
  weightLb: number;
}

/** "Jul 12" from a plain YYYY-MM-DD, built from LOCAL calendar parts — passing
 *  the string to `new Date()` parses it as UTC midnight and renders the day
 *  before for anyone west of Greenwich. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function todayIso(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** Whole years from a DOB, by calendar — not milliseconds, which drifts on leap
 *  years. Shown as derived text; only the DOB is ever stored. */
function ageFrom(dob: string): number | null {
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function AboutYou() {
  const [wUnit] = useWeightUnit();
  const [data, setData] = useState<ProfileData | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      if (!res.ok) return setError(res.status === 401 ? "Session expired — sign in again." : "Couldn't load your profile.");
      const json = await res.json();
      setData(json.profile);
      setLatest(json.latestWeight);
      setError(null);
    } catch {
      setError("Offline — these fields need a connection.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error ?? "Couldn't save.");
    }
    const json = await res.json();
    setData(json.profile);
    setLatest(json.latestWeight);
    setError(null);
    setEditing(null);
  }

  if (data == null) {
    return (
      <>
        <div className={editors.sectionLabel}>About you</div>
        <p className={styles.footnote}>{error ?? "Loading…"}</p>
      </>
    );
  }

  const age = data.dob ? ageFrom(data.dob) : null;

  return (
    <>
      <div className={editors.sectionLabel}>About you</div>

      <Row
        label="Date of birth"
        // The DOB is what's stored; the age is arithmetic. Storing the age
        // instead would rot silently every birthday.
        value={data.dob ? `${shortDate(data.dob)} ${data.dob.slice(0, 4)}${age != null ? ` · ${age}` : ""}` : null}
        open={editing === "dob"}
        onOpen={() => setEditing(editing === "dob" ? null : "dob")}
      >
        <input
          type="date"
          defaultValue={data.dob ?? ""}
          max={todayIso()}
          className={styles.aboutInput}
          onBlur={(e) => save({ dob: e.target.value || null })}
        />
      </Row>

      <Row label="Sex" value={data.sex} open={editing === "sex"} onOpen={() => setEditing(editing === "sex" ? null : "sex")}>
        <div className={editors.segToggle}>
          {["male", "female"].map((s) => (
            <button
              key={s}
              type="button"
              className={data.sex === s ? editors.segActive : editors.segBtn}
              aria-pressed={data.sex === s}
              // Tapping the current value clears it — the only way back to
              // "not recorded" once something is set.
              onClick={() => save({ sex: data.sex === s ? null : s })}
            >
              {s}
            </button>
          ))}
        </div>
      </Row>

      <HeightRow
        heightIn={data.heightIn}
        unit={wUnit}
        open={editing === "height"}
        onOpen={() => setEditing(editing === "height" ? null : "height")}
        onSave={(inches) => save({ heightIn: inches })}
      />

      <Row
        label="Training years"
        value={data.trainingYears == null ? null : `${data.trainingYears}`}
        open={editing === "years"}
        onOpen={() => setEditing(editing === "years" ? null : "years")}
      >
        <input
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          defaultValue={data.trainingYears ?? ""}
          placeholder="years of consistent training"
          className={styles.aboutInput}
          onBlur={(e) => save({ trainingYears: e.target.value === "" ? null : Number(e.target.value) })}
        />
      </Row>

      <BodyweightRow
        latest={latest}
        unit={wUnit}
        open={editing === "weight"}
        onOpen={() => setEditing(editing === "weight" ? null : "weight")}
        onSaved={load}
        onError={setError}
      />

      {error && <p className={styles.dataError} role="alert">{error}</p>}

      <p className={styles.footnote}>
        Context only — nothing in the app reads these yet. Weight and height are stored in pounds and inches and
        shown in whatever your weight preference is set to above.
      </p>
    </>
  );
}

function Row({
  label,
  value,
  hint,
  open,
  onOpen,
  children,
}: {
  label: string;
  value: string | null;
  hint?: string;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={editors.fieldLabel}>{label}</span>
        {/* An unset field says so rather than showing a placeholder number —
            absence is a state, not a zero. */}
        <button type="button" className={styles.aboutValue} onClick={onOpen}>
          {value ?? <span className={styles.aboutUnset}>not set</span>}
          <span aria-hidden="true"> ✎</span>
        </button>
        {hint && <span className={editors.fieldNote}>{hint}</span>}
        {open && <div className={styles.aboutEdit}>{children}</div>}
      </div>
    </div>
  );
}

function HeightRow({
  heightIn,
  unit,
  open,
  onOpen,
  onSave,
}: {
  heightIn: number | null;
  unit: "lb" | "kg";
  open: boolean;
  onOpen: () => void;
  onSave: (inches: number | null) => void;
}) {
  // Metric preference → one cm box. Imperial → feet and inches, because a
  // single decimal-feet input is the sort of thing nobody enters correctly.
  const ftIn = heightIn != null ? inToFtIn(heightIn) : { ft: 0, inch: 0 };
  return (
    <Row label="Height" value={formatHeight(heightIn, unit)} open={open} onOpen={onOpen}>
      {unit === "kg" ? (
        <input
          type="number"
          inputMode="decimal"
          step="0.5"
          defaultValue={heightIn != null ? inToCm(heightIn) : ""}
          placeholder="cm"
          className={styles.aboutInput}
          onBlur={(e) => onSave(e.target.value === "" ? null : cmToIn(Number(e.target.value)))}
        />
      ) : (
        <span className={styles.aboutFtIn}>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            defaultValue={heightIn != null ? ftIn.ft : ""}
            placeholder="ft"
            aria-label="Feet"
            className={styles.aboutInputSmall}
            onBlur={(e) => {
              const ft = Number(e.target.value);
              if (e.target.value === "") return onSave(null);
              onSave(ftInToIn(ft, heightIn != null ? ftIn.inch : 0));
            }}
          />
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="11"
            defaultValue={heightIn != null ? ftIn.inch : ""}
            placeholder="in"
            aria-label="Inches"
            className={styles.aboutInputSmall}
            onBlur={(e) => onSave(ftInToIn(heightIn != null ? ftIn.ft : 0, Number(e.target.value || 0)))}
          />
        </span>
      )}
    </Row>
  );
}

function BodyweightRow({
  latest,
  unit,
  open,
  onOpen,
  onSaved,
  onError,
}: {
  latest: Latest | null;
  unit: "lb" | "kg";
  open: boolean;
  onOpen: () => void;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [weight, setWeight] = useState("");

  async function add() {
    if (weight.trim() === "") return;
    // Entry is in the DISPLAY unit; storage is always lb. Converting here, at
    // the boundary, is what keeps a preference toggle from ever touching data.
    const entered = Number(weight);
    if (!Number.isFinite(entered) || entered <= 0) return onError("Enter a weight.");
    const weightLb = unit === "kg" ? kgToLb(entered) : entered;
    const res = await fetch("/api/body-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, weightLb }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return onError(j.error ?? "Couldn't save that weigh-in.");
    }
    setWeight("");
    setDate(todayIso());
    onError(null);
    onSaved();
  }

  const shown = latest == null ? null : `${unit === "kg" ? lbToKg(latest.weightLb) : displayLb(latest.weightLb)} ${unit} · ${shortDate(latest.date)}`;

  return (
    <Row
      label="Bodyweight"
      value={shown}
      hint="Each entry is kept — back-date one to fill in weights you already know."
      open={open}
      onOpen={onOpen}
    >
      <span className={styles.aboutFtIn}>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={unit}
          aria-label={`Weight in ${unit}`}
          className={styles.aboutInputSmall}
        />
        <input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date of this weigh-in"
          className={styles.aboutInput}
        />
        <button type="button" className={styles.dataBtn} onClick={add}>
          Add
        </button>
      </span>
    </Row>
  );
}
