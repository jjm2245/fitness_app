import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, expectedSessionToken, isValidPasscode } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const passcode = body?.passcode;

  if (typeof passcode !== "string" || !isValidPasscode(passcode)) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await expectedSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
