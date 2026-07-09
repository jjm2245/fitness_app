import { and, eq, gt, lt, count } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";

// Brute-force protection for the single shared passcode (spec §14 hardening —
// this is now public). DB-backed rather than in-memory since Vercel functions
// don't reliably share memory across invocations. Single-user app, low
// traffic, so no cron job for cleanup — pruning happens opportunistically on
// each failed attempt instead.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

export const RATE_LIMIT_WINDOW_SECONDS = WINDOW_MS / 1000;

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function isRateLimited(ip: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const [row] = await db
    .select({ value: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.createdAt, windowStart)));
  return (row?.value ?? 0) >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(ip: string): Promise<void> {
  await db.insert(loginAttempts).values({ ip });
  const cutoff = new Date(Date.now() - PRUNE_AGE_MS);
  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, cutoff));
}

export async function clearAttempts(ip: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip));
}
