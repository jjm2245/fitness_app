import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { isRateLimited, recordFailedAttempt, clearAttempts } from "../rateLimit";

// Integration tests against the real local Postgres instance (same pattern
// as src/lib/__tests__/programs.test.ts). Uses dedicated fake IPs per test so
// runs don't interfere with each other or with real login attempts.

async function cleanup(ip: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip));
}

afterEach(async () => {
  await cleanup("203.0.113.10");
  await cleanup("203.0.113.20");
  await cleanup("203.0.113.30");
});

describe("isRateLimited / recordFailedAttempt", () => {
  it("is not rate limited with no prior attempts", async () => {
    expect(await isRateLimited("203.0.113.10")).toBe(false);
  });

  it("is not rate limited below the threshold", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 4; i++) await recordFailedAttempt(ip);
    expect(await isRateLimited(ip)).toBe(false);
  });

  it("becomes rate limited at the threshold (5 failures)", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 5; i++) await recordFailedAttempt(ip);
    expect(await isRateLimited(ip)).toBe(true);
  });

  it("tracks IPs independently", async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt("203.0.113.20");
    expect(await isRateLimited("203.0.113.20")).toBe(true);
    expect(await isRateLimited("203.0.113.30")).toBe(false);
  });
});

describe("clearAttempts", () => {
  it("resets a rate-limited IP back to allowed", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 5; i++) await recordFailedAttempt(ip);
    expect(await isRateLimited(ip)).toBe(true);

    await clearAttempts(ip);
    expect(await isRateLimited(ip)).toBe(false);
  });
});

describe("stale attempt pruning", () => {
  it("prunes attempts older than the retention window on the next write", async () => {
    const ip = "203.0.113.10";
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(loginAttempts).values({ ip, createdAt: twoDaysAgo });

    await recordFailedAttempt(ip); // triggers opportunistic pruning as a side effect

    const remaining = await db.select().from(loginAttempts).where(eq(loginAttempts.ip, ip));
    expect(remaining.every((r) => r.createdAt > twoDaysAgo)).toBe(true);
  });
});
