import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, isValidPasscode } from "@/lib/auth";
import { clientIp, isRateLimited, recordFailedAttempt, clearAttempts, RATE_LIMIT_WINDOW_SECONDS } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  if (await isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) } }
    );
  }

  const body = await request.json().catch(() => null);
  const passcode = body?.passcode;

  if (typeof passcode !== "string" || !isValidPasscode(passcode)) {
    await recordFailedAttempt(ip);
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  await clearAttempts(ip);

  const { token } = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
