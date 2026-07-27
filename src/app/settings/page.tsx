"use client";

import styles from "./settings.module.css";
import editors from "@/components/editors/editors.module.css";
import { useDistanceUnit, useWeightUnit } from "@/lib/useUnit";
import { AboutYou } from "./AboutYou";
import { DataExport } from "./DataExport";
import pkg from "../../../package.json";

// Settings — the home of GLOBAL preferences.
//
// The model this screen exists to make legible: there are two units, with two
// different owners.
//
//   Entry unit       a fact about the MACHINE — what you type. The pin says
//                    120, you type 120. Owned by the unit's stack marking.
//   Display preference  a fact about YOU — what you read and think in. Global,
//                    rarely changed, governs history, stats and totals.
//
// One toggle in the exercise card used to do both, which is why changing it
// mid-session had the wrong blast radius: it looked local and behaved global.
// It lives here now, so changing it is a deliberate trip rather than a stray tap.
function UnitRow({
  label,
  hint,
  options,
  value,
  onSelect,
}: {
  label: string;
  hint: string;
  options: readonly string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={editors.fieldLabel}>{label}</span>
        <span className={editors.fieldNote}>{hint}</span>
      </div>
      <div className={`${editors.segToggle} ${styles.rowControl}`}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`${o === value ? editors.segActive : editors.segBtn} ${styles.segMono}`}
            aria-pressed={o === value}
            onClick={() => onSelect(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [wUnit, toggleWeight] = useWeightUnit();
  const [dUnit, toggleDistance] = useDistanceUnit();

  return (
    <main className={editors.page}>
      <div className={editors.titleRow}>
        <h1 className={editors.title}>Settings</h1>
      </div>

      <div className={editors.sectionLabel}>Preferences</div>

      <UnitRow
        label="Weight"
        hint="Machines marked in their own unit override this."
        options={["lb", "kg"] as const}
        value={wUnit}
        onSelect={(v) => { if (v !== wUnit) toggleWeight(); }}
      />
      <UnitRow
        label="Distance"
        hint="Used everywhere distances are shown."
        options={["mi", "km"] as const}
        value={dUnit}
        onSelect={(v) => { if (v !== dUnit) toggleDistance(); }}
      />

      <p className={styles.footnote}>
        Display only — your data is always stored in pounds and miles. Switching never changes a logged number.
      </p>

      <AboutYou />

      <DataExport />

      <p className={styles.version}>Fitness Agent v{pkg.version}</p>
    </main>
  );
}
