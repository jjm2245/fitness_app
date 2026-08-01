import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { equipmentComparability } from "@/db/schema";
import { pairKey } from "@/lib/comparability";

// POST /api/stats/comparability — record (or flip) a comparability decision.
//
// Decisions-only storage: the suggestion's basis text is snapshotted here at
// decision time, so a later spec edit can't silently change what was agreed
// to. Flip = the same POST with the opposite status; the unique (a, b, kind)
// row is updated in place, both directions.

const KINDS = new Set(["same_setup", "ratio_estimate"]);
const STATUSES = new Set(["confirmed", "rejected"]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const a = typeof body?.a === "string" ? body.a : "";
  const b = typeof body?.b === "string" ? body.b : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const status = typeof body?.status === "string" ? body.status : "";
  const basis = typeof body?.basis === "string" ? body.basis : "";

  if (!a || !b || a === b) return NextResponse.json({ error: "two distinct units required" }, { status: 400 });
  if (!KINDS.has(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  if (!STATUSES.has(status)) return NextResponse.json({ error: "unknown status" }, { status: 400 });
  if (!basis.trim()) return NextResponse.json({ error: "basis is required — the decision must record what was agreed to" }, { status: 400 });

  const [idA, idB] = pairKey(a, b);

  const [row] = await db
    .insert(equipmentComparability)
    .values({ equipmentIdA: idA, equipmentIdB: idB, kind, status, basis })
    .onConflictDoUpdate({
      target: [
        equipmentComparability.equipmentIdA,
        equipmentComparability.equipmentIdB,
        equipmentComparability.kind,
      ],
      set: { status, basis, decidedAt: sql`now()` },
    })
    .returning();

  return NextResponse.json({
    id: row.id,
    a: row.equipmentIdA,
    b: row.equipmentIdB,
    kind: row.kind,
    status: row.status,
    basis: row.basis,
    decidedAt: row.decidedAt.toISOString(),
  });
}
