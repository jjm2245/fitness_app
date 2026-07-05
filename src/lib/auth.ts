// Edge-runtime compatible (proxy.ts runs on Edge, which doesn't support node:crypto),
// so this uses Web Crypto (SubtleCrypto) instead of the node:crypto module.

export const SESSION_COOKIE = "fa_session";

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

export async function expectedSessionToken(): Promise<string> {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) {
    throw new Error("APP_PASSCODE is not set");
  }
  return hmacSha256Hex(passcode, "fitness-app-session");
}

export function isValidPasscode(candidate: string): boolean {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return false;
  return constantTimeEqual(candidate, passcode);
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await expectedSessionToken();
  return constantTimeEqual(token, expected);
}
