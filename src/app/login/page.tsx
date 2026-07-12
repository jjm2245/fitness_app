"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// useSearchParams must sit under a Suspense boundary or the build errors on the
// statically-rendered login route.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
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
    <main style={{ maxWidth: 320, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <form onSubmit={handleSubmit}>
        <label htmlFor="passcode">Device passcode</label>
        <input
          id="passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
          style={{ display: "block", width: "100%", margin: "0.5rem 0" }}
        />
        <button type="submit">Unlock</button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </form>
    </main>
  );
}
