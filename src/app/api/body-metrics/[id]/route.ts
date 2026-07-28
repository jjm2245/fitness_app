import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { bodyMetrics } from "@/db/schema";

// PATCH/DELETE /api/body-metrics/[id] — correct or remove one weigh-in.
//
// A weigh-in is an observation, so both its VALUE and its DATE can be wrong and
// both are correctable. What is never acceptable is one correction silently
// destroying another measurement — see the conflict handling below.

function todayIso(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const updates: { date?: string; weight?: string } = {};

  if (body?.date !== undefined) {
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    // Calendar-string comparison, not Date arithmetic — "today" is a local
    // calendar idea and building a Date here reintroduces the timezone class of
    // bug this codebase keeps paying for.
    if (date > todayIso()) {
      return NextResponse.json({ error: "a weigh-in can't be in the future" }, { status: 400 });
    }

    // THE IMPORTANT CASE. `body_metrics_date_uniq` allows one row per date, so
    // moving this entry onto an occupied date must be REFUSED, not upserted:
    // an upsert here would overwrite a real measurement taken on that day and
    // there would be no trace of what was lost. Adding on an existing date is a
    // different act — that's a correction to that day, and POST still does it.
    const [clash] = await db
      .select({ id: bodyMetrics.id, weight: bodyMetrics.weight })
      .from(bodyMetrics)
      .where(and(eq(bodyMetrics.date, date), ne(bodyMetrics.id, rowId)));
    if (clash) {
      return NextResponse.json(
        {
          error: "date_taken",
          date,
          existingId: clash.id,
          existingWeightLb: clash.weight == null ? null : Number(clash.weight),
        },
        { status: 409 }
      );
    }
    updates.date = date;
  }

  if (body?.weightLb !== undefined) {
    const w = Number(body.weightLb);
    if (!Number.isFinite(w) || w <= 0 || w > 1500) {
      return NextResponse.json({ error: "weightLb must be a plausible weight in pounds" }, { status: 400 });
    }
    updates.weight = String(w);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const [row] = await db
    .update(bodyMetrics)
    .set(updates)
    .where(eq(bodyMetrics.id, rowId))
    .returning({ id: bodyMetrics.id, date: bodyMetrics.date, weight: bodyMetrics.weight });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ id: row.id, date: row.date, weightLb: row.weight == null ? null : Number(row.weight) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // No delete-guard ceremony: nothing references `body_metrics`, so removing a
  // weigh-in orphans nothing. The confirmation lives in the UI, where the user
  // can see what they're removing — a guard here would only be theatre.
  const [row] = await db.delete(bodyMetrics).where(eq(bodyMetrics.id, rowId)).returning({ id: bodyMetrics.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: row.id });
}
