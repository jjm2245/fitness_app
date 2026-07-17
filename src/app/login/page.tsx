"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";

// The title screen: app mark + name + one action (unlock). Restyle only —
// the auth POST and the ?next= return flow are unchanged.
// useSearchParams must sit under a Suspense boundary or the build errors on the
// statically-rendered login route.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

// Simple barbell glyph — plate · bar · plate.
function BarbellMark() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect x="4" y="14" width="6" height="16" rx="2" fill="currentColor" />
      <rect x="10" y="17" width="4" height="10" rx="1.5" fill="currentColor" opacity="0.7" />
      <rect x="14" y="20.5" width="16" height="3" rx="1.5" fill="currentColor" />
      <rect x="30" y="17" width="4" height="10" rx="1.5" fill="currentColor" opacity="0.7" />
      <rect x="34" y="14" width="6" height="16" rx="2" fill="currentColor" />
    </svg>
  );
}

function LoginForm() {
  const [passcode, setPasscode] = useState("");
  const [show, setShow] = useState(false); // eye toggle — hidden by default
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      // Return to where the session expired (e.g. the log screen), so a pending
      // outbox re-drains in context. Only same-origin relative paths allowed.
      const next = searchParams.get("next");
      router.push(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } else {
      setError("Wrong passcode");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.markWrap}>
        <div className={styles.markGlow} />
        <div className={styles.mark}>
          <BarbellMark />
        </div>
      </div>
      <div className={styles.appName}>Fitness Agent</div>
      <p className={styles.tagline}>Your training, optimized.</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <label
          htmlFor="passcode"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        >
          Device passcode
        </label>
        <div className={styles.passcodeRow}>
          <input
            id="passcode"
            type={show ? "text" : "password"}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="••••"
            className={`${styles.passcode} ${show ? styles.passcodeRevealed : ""}`}
          />
          <button
            type="button"
            className={styles.eye}
            aria-label={show ? "Hide passcode" : "Show passcode"}
            aria-pressed={show}
            onClick={() => setShow((s) => !s)}
          >
            {show ? (
              // eye-off
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.6 4.2 9.8 6.3.2.4.2.9 0 1.3-.5.9-1.6 2.4-3.2 3.7M6.6 6.7C4.6 8 3.1 9.9 2.2 11.4c-.2.4-.2.9 0 1.3C3.4 14.8 7 19 12 19c1.5 0 2.9-.4 4.1-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
                <path d="M9.9 10a3 3 0 0 0 4.1 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
              </svg>
            ) : (
              // eye
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M2.2 11.4C3.4 9.2 7 5 12 5s8.6 4.2 9.8 6.4c.2.4.2.9 0 1.3C20.6 14.8 17 19 12 19s-8.6-4.2-9.8-6.4a1.4 1.4 0 0 1 0-1.2z" stroke="currentColor" strokeWidth="1.7" fill="none" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" fill="none" />
              </svg>
            )}
          </button>
        </div>
        <button type="submit" className={styles.unlock}>
          Unlock
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </main>
  );
}
