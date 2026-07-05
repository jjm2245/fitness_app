import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Fitness Agent</h1>
      <p>Deterministic core + logging UX. No LLM coaching yet.</p>
      <p>
        <Link href="/log">Log a session</Link>
      </p>
    </main>
  );
}
