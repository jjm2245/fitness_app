// Shared types + fetch helper for the editor screens (phase 3). These mirror
// what the program/blocks routes return; the session screen keeps its own
// copies in components/session/shared.ts.

export interface EditorExercise {
  id: number;
  dayId: number;
  exerciseId: string;
  targetSets: number;
  repRange: string | null;
  rirTarget: string | null;
  orderIndex: number;
  exerciseName: string;
  loadType: string;
  portable: boolean;
  conditioningOnly: boolean;
  source: string;
  untagged: boolean;
  params?: Record<string, unknown> | null;
}

export interface EditorDay {
  id: number;
  programId: number;
  name: string;
  orderIndex: number;
  exercises: EditorExercise[];
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`${options?.method ?? "GET"} ${url} failed: ${res.status}`);
  return res.json();
}
