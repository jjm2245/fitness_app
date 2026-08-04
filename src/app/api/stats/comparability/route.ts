import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { equipmentComparability } from "@/db/schema";
import { pairKey } from "@/lib/comparability";

// POST /api/stats/comparability — record (or change) a comparability decision.
//
// Decisions-only storage; basis snapshotted at decision time. v1.1 adds the
// owner-declared flow: `factor` rides along for a declared ratio estimate
// (CHECK-enforced — the declaration IS the number), and a write SUPERSEDES any
// other-kind row for the pair, so a pair holds exactly ONE live decision.
// Switching modes in the combine card is therefore one write, and reopening
// the card always finds a single current state to prefill.

const KINDS = new Set(["same_setup", "ratio_estimate"]);
const STATUSES = new Set(["confirmed", "rejected"]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const a = typeof body?.a === "string" ? body.a : "";
  const b = typeof body?.b === "string" ? body.b : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const status = typeof body?.status === "string" ? body.status : "";
  const basis = typeof body?.basis === "string" ? body.basis : "";
  const factorRaw = body?.factor;
  const factor =
    factorRaw == null || factorRaw === "" ? null : Number.isFinite(Number(factorRaw)) ? Number(factorRaw) : NaN;

  if (!a || !b || a === b) return NextResponse.json({ error: "two distinct units required" }, { status: 400 });
  if (!KINDS.has(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  if (!STATUSES.has(status)) return NextResponse.json({ error: "unknown status" }, { status: 400 });
  if (!basis.trim()) return NextResponse.json({ error: "basis is required — the decision must record what was agreed to" }, { status: 400 });
  if (Number.isNaN(factor) || (factor != null && factor <= 0))
    return NextResponse.json({ error: "factor must be a positive number" }, { status: 400 });
  // Only a CONFIRMED declaration needs the number — a rejection is not a ratio.
  if (kind === "ratio_estimate" && status === "confirmed" && basis.startsWith("owner-declared") && factor == null)
    return NextResponse.json({ error: "an owner-declared estimate needs its factor — it is stored nowhere else" }, { status: 400 });

  const [idA, idB] = pairKey(a, b);

  // ONE live decision per pair: drop any row of the OTHER kind before writing.
  await db
    .delete(equipmentComparability)
    .where(
      and(
        eq(equipmentComparability.equipmentIdA, idA),
        eq(equipmentComparability.equipmentIdB, idB),
        ne(equipmentComparability.kind, kind)
      )
    );

  const [row] = await db
    .insert(equipmentComparability)
    .values({ equipmentIdA: idA, equipmentIdB: idB, kind, status, basis, factor: factor == null ? null : String(factor) })
    .onConflictDoUpdate({
      target: [
        equipmentComparability.equipmentIdA,
        equipmentComparability.equipmentIdB,
        equipmentComparability.kind,
      ],
      set: { status, basis, factor: factor == null ? null : String(factor), decidedAt: sql`now()` },
    })
    .returning();

  return NextResponse.json({
    id: row.id,
    a: row.equipmentIdA,
    b: row.equipmentIdB,
    kind: row.kind,
    status: row.status,
    basis: row.basis,
    factor: row.factor == null ? null : Number(row.factor),
    decidedAt: row.decidedAt.toISOString(),
  });
}
