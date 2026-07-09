// Edge-runtime compatible (proxy.ts runs on Edge, which doesn't support node:crypto),
// so this uses Web Crypto (SubtleCrypto) instead of the node:crypto module.

export const SESSION_COOKIE = "fa_session";

// 30 days: long enough that a personal daily-use app rarely shows the login
// screen, short enough that a leaked/stale cookie doesn't work forever now
// that this is public on the internet. See DECISIONS.md.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return secret;
}

export function isValidPasscode(candidate: string): boolean {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return false;
  return constantTimeEqual(candidate, passcode);
}

// A session token is `<expiryEpochSeconds>.<hmacHex>`, signed with
// SESSION_SECRET — a separate secret from APP_PASSCODE, so forging a session
// isn't tied to guessing the (low-entropy, human-typed) passcode.
export async function createSessionToken(): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const signature = await hmacSha256Hex(sessionSecret(), `${SESSION_COOKIE}:${expiresAt}`);
  return { token: `${expiresAt}.${signature}`, expiresAt };
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresAtStr, signature] = token.split(".");
  if (!expiresAtStr || !signature) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false; // malformed or expired
  }

  const expected = await hmacSha256Hex(sessionSecret(), `${SESSION_COOKIE}:${expiresAtStr}`);
  return constantTimeEqual(signature, expected);
}
