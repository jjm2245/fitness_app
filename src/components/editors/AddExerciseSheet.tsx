"use client";

import { useState } from "react";
import { Sheet } from "@/components/session/Sheet";
import { ExerciseSearch, type ExerciseSearchResult } from "@/components/ExerciseSearch";
import styles from "./editors.module.css";
import { api } from "./types";

// Add-exercise sheet for the program/blocks editors — the session AddSheet
// pattern: search library/curated or create custom (tag-on-add lives inside
// ExerciseSearch). Stays open for multi-add; close when done.
export function AddExerciseSheet({
  dayId,
  noun,
  onAdded,
  onClose,
}: {
  dayId: number;
  noun: string;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const [added, setAdded] = useState<string[]>([]);

  async function add(r: ExerciseSearchResult) {
    await api(`/api/program-days/${dayId}/exercises`, {
      method: "POST",
      body: JSON.stringify({ exerciseId: r.id }),
    });
    setAdded((a) => [...a, r.name]);
    await onAdded();
  }

  return (
    <Sheet
      title="Add exercise"
      subtitle={`Search the library and your customs — added to this ${noun} as you tap. Add several; close when done.`}
      onClose={onClose}
    >
      <div>
        <ExerciseSearch onPick={add} placeholder="Search library / curated, or create custom…" />
      </div>
      {added.length > 0 && (
        <p className={styles.fieldNote}>Added: {added.join(", ")}</p>
      )}
    </Sheet>
  );
}
