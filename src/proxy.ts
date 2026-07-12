import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSessionToken(token)) {
    return NextResponse.next();
  }

  // API requests must fail loudly with 401, not silently redirect. The outbox
  // POSTs to /api/*; a 307 → /login would resolve to a 200 HTML page that
  // res.json() chokes on, so a set logged offline would show "not synced"
  // forever after the session cookie expired (data-integrity bug). A real 401
  // lets sync() classify it as an auth failure and prompt re-login + re-drain.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "auth", reason: "session expired" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/auth/login|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)",
  ],
};
