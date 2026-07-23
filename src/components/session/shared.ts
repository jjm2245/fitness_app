// Shared types + tiny formatters for the session-screen components (phase 2).
// These moved out of /log/[id]/page.tsx unchanged — the page remains the
// orchestrator; components receive state/handlers as props.

export interface ProgramExerciseDetail {
  id: number;
  exerciseId: string;
  targetSets: number | null;
  repRange: string | null;
  rirTarget: string | null;
  orderIndex: number;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  params: Record<string, unknown> | null;
  logFields?: unknown;
  source: string;
  untagged: boolean;
  unilateral?: boolean;
}
export interface ProgramDayDetail {
  id: number;
  name: string;
  orderIndex: number;
  exercises: ProgramExerciseDetail[];
}
export interface ProgramDetail {
  id: number;
  splitType: string;
  days: ProgramDayDetail[];
}
export interface EquipmentOption {
  id: string; // opaque stable key (surrogate-key model)
  label: string; // display name
  builtInWeight: string | null; // auto-applied additive offset when selected
  notes: string | null;
}
export interface BlockDetail {
  id: number;
  name: string;
  exercises: ProgramExerciseDetail[];
}
export interface SubstitutionCandidate {
  id: string;
  name: string;
  score: number;
  loadType: string;
  portable: boolean;
  unilateral?: boolean;
}

export type ProgressionResult =
  | { status: "new_machine_baseline"; reason: string }
  | {
      status: "resolved";
      signal:
        | { type: "insufficient_data" }
        | { type: "increase_load"; reason: string; suggestedLoad?: number }
        | { type: "progressing"; reason: string }
        | { type: "true_stall"; reason: string }
        | { type: "regression"; reason: string }
        | { type: "hold"; reason: string };
      intervention?: { id: string; message: string };
    };

// A card = one performed occurrence (v2). Ordered; repeats produce multiple
// cards for the same exercise, each with its own instanceId + sets.
export interface LoggableOccurrence {
  instanceId: string;
  orderIndex: number;
  exerciseId: string;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  target: { targetSets: number; repRange: string | null; rirTarget: string | null } | null;
  params: Record<string, unknown> | null;
  logFields?: unknown;
  source: string;
  provenance: string;
  untagged: boolean;
  unilateral: boolean;
}

export interface CardControls {
  position: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export type EffortTag = "more_in_me" | "near_failure" | "to_failure";
export const EFFORT_OPTIONS: { value: EffortTag; label: string }[] = [
  { value: "more_in_me", label: "More in me" },
  { value: "near_failure", label: "Near failure" },
  { value: "to_failure", label: "To failure" },
];
export const EFFORT_LABEL: Record<EffortTag, string> = {
  more_in_me: "more in me",
  near_failure: "near failure",
  to_failure: "to failure",
};

export function fmtRest(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
// Digits-only mm:ss mask: the user types digits, the colon is ours. "145"
// reads as 1:45 (fill from the right); seconds clamp to :59; bounded to
// [0:00, 59:59] so a fat-finger can't record an hour-long rest.
export function digitsToSeconds(digits: string): number {
  const d = digits.replace(/\D/g, "").slice(-4);
  if (!d) return 0;
  const secs = Math.min(59, Number(d.slice(-2)));
  const mins = Math.min(59, Number(d.slice(0, -2) || "0"));
  return mins * 60 + secs;
}
