import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { bodyMetrics } from "@/db/schema";

// GET/POST /api/body-metrics — dated weigh-ins.
//
// APPEND, never overwrite. A weigh-in is an observation with a date attached,
// so recording a new one must not erase the old: that history IS the trend, and
// it is the whole reason bodyweight lives here rather than as a mutable field
// on `profile`.
//
// The one exception is same-date: a unique index on `date` means correcting
// this morning's number updates this morning's row instead of leaving two rows
// for one morning. One weigh-in per day is the model.
//
// BACK-DATING IS A FEATURE. Weights you already know from before today are as
// real as today's; refusing them would force the trend to start from scratch.
// The only date refused is a future one, which can't be an observation.

export async function GET() {
  const rows = await db
    .select({ id: bodyMetrics.id, date: bodyMetrics.date, weight: bodyMetrics.weight })
    .from(bodyMetrics)
    .orderBy(desc(bodyMetrics.date));

  // Canonical lb. Returned newest-first — the shape a history view would want,
  // so adding one is a component, not a rework of this route.
  return NextResponse.json(
    rows
      .filter((r) => r.weight != null)
      .map((r) => ({ id: r.id, date: r.date, weightLb: Number(r.weight) }))
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const date = typeof body?.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  // Compared as calendar strings, not instants: "today" is a local-calendar
  // idea, and building a Date here would reintroduce the timezone class of bug
  // this codebase keeps paying for.
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  if (date > todayStr) {
    return NextResponse.json({ error: "a weigh-in can't be in the future", today: todayStr }, { status: 400 });
  }

  const weightLb = Number(body?.weightLb);
  if (!Number.isFinite(weightLb) || weightLb <= 0 || weightLb > 1500) {
    return NextResponse.json({ error: "weightLb must be a plausible weight in pounds" }, { status: 400 });
  }

  const [row] = await db
    .insert(bodyMetrics)
    .values({ date, weight: String(weightLb) })
    .onConflictDoUpdate({ target: bodyMetrics.date, set: { weight: String(weightLb) } })
    .returning({ id: bodyMetrics.id, date: bodyMetrics.date, weight: bodyMetrics.weight });

  return NextResponse.json({ id: row.id, date: row.date, weightLb: Number(row.weight) });
}
