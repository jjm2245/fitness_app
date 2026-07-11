"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, DayEditor, type ProgramDayDetail } from "@/components/DayEditor";
import styles from "@/components/DayEditor.module.css";

// Reusable blocks are the block-library program's days. This editor is the same
// day/exercise editor as /program, pointed at blocks — define "Abs — machine",
// "Cardio", etc. once, then attach them to a session in one tap from /log.
export default function BlocksEditorPage() {
  const [blocks, setBlocks] = useState<ProgramDayDetail[]>([]);
  const [newBlockName, setNewBlockName] = useState("");

  const refresh = useCallback(async () => {
    const list = await api<ProgramDayDetail[]>("/api/blocks");
    setBlocks(list);
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  async function createBlock(e: React.FormEvent) {
    e.preventDefault();
    if (newBlockName.trim() === "") return;
    await api("/api/blocks", { method: "POST", body: JSON.stringify({ name: newBlockName.trim() }) });
    setNewBlockName("");
    await refresh();
  }

  return (
    <main className={styles.page}>
      <p>
        <Link href="/log">Back to logging</Link> · <Link href="/program">Program editor</Link>
      </p>
      <h1>Reusable blocks</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        A block is a named, reusable set of exercises (e.g. &quot;Abs — machine&quot;, &quot;Cardio&quot;). Attach one
        to a session in one tap from the logging screen; attaching or skipping is always optional.
      </p>

      {blocks.map((block) => (
        <DayEditor key={block.id} day={block} onChanged={refresh} dayNoun="block" />
      ))}

      <form onSubmit={createBlock} className={styles.inlineForm} style={{ marginTop: 12 }}>
        <input value={newBlockName} onChange={(e) => setNewBlockName(e.target.value)} placeholder="New block name" />
        <button type="submit">Add block</button>
      </form>
    </main>
  );
}
