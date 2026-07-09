import { describe, it, expect, beforeAll } from "vitest";
import { isValidPasscode, createSessionToken, isValidSessionToken, SESSION_TTL_SECONDS } from "../auth";

beforeAll(() => {
  process.env.APP_PASSCODE = "test-passcode-123";
  process.env.SESSION_SECRET = "test-session-secret-do-not-use-in-prod";
});

describe("isValidPasscode", () => {
  it("accepts the correct passcode", () => {
    expect(isValidPasscode("test-passcode-123")).toBe(true);
  });

  it("rejects an incorrect passcode", () => {
    expect(isValidPasscode("wrong")).toBe(false);
  });

  it("rejects a passcode of a different length (would otherwise short-circuit compare)", () => {
    expect(isValidPasscode("test-passcode-123-and-more")).toBe(false);
  });
});

describe("createSessionToken / isValidSessionToken", () => {
  it("a freshly created token is valid", async () => {
    const { token } = await createSessionToken();
    expect(await isValidSessionToken(token)).toBe(true);
  });

  it("expiresAt is SESSION_TTL_SECONDS in the future", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { expiresAt } = await createSessionToken();
    expect(expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL_SECONDS);
    expect(expiresAt).toBeLessThanOrEqual(before + SESSION_TTL_SECONDS + 5); // small slack for test runtime
  });

  it("rejects a token with a tampered signature", async () => {
    const { token } = await createSessionToken();
    const [expiresAt] = token.split(".");
    const tampered = `${expiresAt}.0000000000000000000000000000000000000000000000000000000000000000`;
    expect(await isValidSessionToken(tampered)).toBe(false);
  });

  it("rejects a token with a past expiry, even with a validly recomputed signature", async () => {
    // Simulate a token whose expiry has already passed by constructing one
    // the same way createSessionToken does, but with a past timestamp.
    const pastExpiry = Math.floor(Date.now() / 1000) - 60;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(process.env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`fa_session:${pastExpiry}`));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const expiredToken = `${pastExpiry}.${hex}`;

    expect(await isValidSessionToken(expiredToken)).toBe(false);
  });

  it("rejects malformed tokens", async () => {
    expect(await isValidSessionToken("not-a-real-token")).toBe(false);
    expect(await isValidSessionToken("")).toBe(false);
    expect(await isValidSessionToken(undefined)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await createSessionToken();
    process.env.SESSION_SECRET = "a-different-secret";
    expect(await isValidSessionToken(token)).toBe(false);
    process.env.SESSION_SECRET = "test-session-secret-do-not-use-in-prod"; // restore
  });
});
