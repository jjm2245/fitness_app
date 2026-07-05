"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      router.push("/");
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
