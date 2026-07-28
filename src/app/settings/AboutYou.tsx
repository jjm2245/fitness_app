"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./settings.module.css";
import editors from "@/components/editors/editors.module.css";
import { useWeightUnit } from "@/lib/useUnit";
import { WeighInHistory } from "./WeighInHistory";
import { NumberInput } from "@/components/NumberInput";
import { INT_DIGITS } from "@/lib/numericInput";
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [yearsText, setYearsText] = useState("");

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
  // Re-seed the controlled text whenever the stored value arrives or changes.
  useEffect(() => {
    setYearsText(data?.trainingYears == null ? "" : String(data.trainingYears));
  }, [data?.trainingYears]);

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
        <NumberInput
          value={yearsText}
          onChange={setYearsText}
          maxIntDigits={INT_DIGITS.trainingYears}
          placeholder="years of consistent training"
          className={styles.aboutInput}
          ariaLabel="Years of consistent training"
        />
        <button type="button" className={styles.dataBtn} onClick={() => save({ trainingYears: yearsText === "" ? null : Number(yearsText) })}>Save</button>
      </Row>

      <BodyweightRow latest={latest} unit={wUnit} onOpen={() => setHistoryOpen(true)} />

      {historyOpen && (
        // `load` refetches the profile payload, whose latestWeight drives the
        // summary above — so any add/edit/delete in the sheet is reflected the
        // moment it lands.
        <WeighInHistory unit={wUnit} onClose={() => setHistoryOpen(false)} onChanged={load} />
      )}

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
  // Controlled so the mask can refuse a keystroke; keyed re-seed below keeps
  // them in step with the stored value and with a unit change.
  const [cmText, setCmText] = useState(heightIn != null ? String(inToCm(heightIn)) : "");
  const [ftText, setFtText] = useState(heightIn != null ? String(ftIn.ft) : "");
  const [inText, setInText] = useState(heightIn != null ? String(ftIn.inch) : "");
  return (
    <Row label="Height" value={formatHeight(heightIn, unit)} open={open} onOpen={onOpen}>
      {unit === "kg" ? (
        <span className={styles.aboutFtIn}>
          <NumberInput
            value={cmText}
            onChange={setCmText}
            maxIntDigits={INT_DIGITS.heightCm}
            placeholder="cm"
            className={styles.aboutInput}
            ariaLabel="Height in centimetres"
          />
          <button
            type="button"
            className={styles.dataBtn}
            onClick={() => onSave(cmText === "" ? null : cmToIn(Number(cmText)))}
          >
            Save
          </button>
        </span>
      ) : (
        <span className={styles.aboutFtIn}>
          <NumberInput
            value={ftText}
            onChange={setFtText}
            maxIntDigits={INT_DIGITS.heightFt}
            allowDecimal={false}
            placeholder="ft"
            ariaLabel="Feet"
            className={styles.aboutInputSmall}
          />
          <NumberInput
            value={inText}
            onChange={setInText}
            maxIntDigits={INT_DIGITS.heightIn}
            allowDecimal={false}
            placeholder="in"
            ariaLabel="Inches"
            className={styles.aboutInputSmall}
          />
          <button
            type="button"
            className={styles.dataBtn}
            onClick={() => onSave(ftText === "" && inText === "" ? null : ftInToIn(Number(ftText || 0), Number(inText || 0)))}
          >
            Save
          </button>
        </span>
      )}
    </Row>
  );
}

function BodyweightRow({
  latest,
  unit,
  onOpen,
}: {
  latest: Latest | null;
  unit: "lb" | "kg";
  onOpen: () => void;
}) {
  // A SUMMARY of the latest entry — the history sheet is where weigh-ins are
  // managed. `latest` is recomputed from the server after every write, so
  // deleting the newest entry falls back to the next one rather than showing a
  // stale number, and reads "not set" once none remain.
  const shown =
    latest == null
      ? null
      : `${unit === "kg" ? lbToKg(latest.weightLb) : displayLb(latest.weightLb)} ${unit} · ${shortDate(latest.date)}`;

  return (
    <Row
      label="Bodyweight"
      value={shown}
      hint="Every entry is kept — tap to see, correct or back-date past weigh-ins."
      open={false}
      onOpen={onOpen}
    >
      {null}
    </Row>
  );
}
