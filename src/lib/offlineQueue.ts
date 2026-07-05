"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface PendingSet {
  id?: number;
  date: string;
  exerciseId: string;
  machineId: string | null;
  setIndex: number;
  setType: "warmup" | "working";
  load: number;
  reps: number;
  rir: number | null;
}

interface OutboxSchema extends DBSchema {
  pending_sets: {
    key: number;
    value: PendingSet;
  };
}

let dbPromise: Promise<IDBPDatabase<OutboxSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OutboxSchema>("fitness-app-outbox", 1, {
      upgrade(db) {
        db.createObjectStore("pending_sets", { keyPath: "id", autoIncrement: true });
      },
    });
  }
  return dbPromise;
}

// Queue-first write: every logged set lands in IndexedDB immediately so logging
// never blocks on connectivity, then flushQueue() pushes it to the server.
export async function queueSet(entry: PendingSet): Promise<void> {
  const db = await getDb();
  await db.add("pending_sets", entry);
}

export async function getPendingSets(): Promise<PendingSet[]> {
  const db = await getDb();
  return db.getAll("pending_sets");
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const db = await getDb();
  const pending = await db.getAll("pending_sets");
  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    try {
      const res = await fetch("/api/set-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      if (entry.id !== undefined) {
        await db.delete("pending_sets", entry.id);
      }
      synced += 1;
    } catch {
      failed += 1; // stays queued, retried on next flush
    }
  }

  return { synced, failed };
}
