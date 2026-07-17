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
        <input
          id="passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="••••"
          className={styles.passcode}
        />
        <button type="submit" className={styles.unlock}>
          Unlock
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </main>
  );
}
