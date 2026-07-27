import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { profile, bodyMetrics } from "@/db/schema";

// GET/PATCH /api/profile — "About you": the facts that change on a scale of
// years, plus the latest weigh-in read from `body_metrics`.
//
// NOTHING in the app reads these yet. They are context, recorded now so a trend
// exists later; the screen says so plainly rather than implying they do work.
//
// Bodyweight is deliberately NOT here as a column. It changes, so it lives in
// `body_metrics` as dated rows and this route only reports the newest one. See
// DECISIONS 2026-07-27: bodyweight is a body-composition metric, not a load
// input — it never feeds `set_logs.load`.

const SINGLETON_ID = 1;

/** Numeric-or-absent. "" and whitespace mean "cleared", which is NULL, never 0. */
function num(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Text-or-absent, with the same empty-means-cleared rule. */
function str(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  return v.trim() === "" ? null : v.trim();
}

export async function GET() {
  const [row] = await db.select().from(profile).where(eq(profile.id, SINGLETON_ID));
  const [latest] = await db
    .select({ date: bodyMetrics.date, weight: bodyMetrics.weight })
    .from(bodyMetrics)
    .where(sql`${bodyMetrics.weight} is not null`)
    .orderBy(desc(bodyMetrics.date))
    .limit(1);

  return NextResponse.json({
    // Absent profile is a valid state, not an error — nothing has been filled in.
    profile: row
      ? {
          dob: row.dob,
          sex: row.sex,
          heightIn: row.heightIn == null ? null : Number(row.heightIn),
          trainingYears: row.trainingYears == null ? null : Number(row.trainingYears),
        }
      : { dob: null, sex: null, heightIn: null, trainingYears: null },
    // Canonical lb, like every weight in this schema.
    latestWeight: latest ? { date: latest.date, weightLb: Number(latest.weight) } : null,
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const updates: Record<string, unknown> = {};
  const dob = str(body?.dob);
  // A date column will reject anything malformed anyway, but failing here keeps
  // the error legible instead of a driver stack trace.
  if (dob !== undefined) {
    if (dob !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return NextResponse.json({ error: "dob must be YYYY-MM-DD or null" }, { status: 400 });
    }
    updates.dob = dob;
  }
  const sex = str(body?.sex);
  if (sex !== undefined) updates.sex = sex;

  const heightIn = num(body?.heightIn);
  if (heightIn !== undefined) {
    if (heightIn !== null && (heightIn <= 0 || heightIn > 108)) {
      return NextResponse.json({ error: "heightIn must be a plausible number of inches" }, { status: 400 });
    }
    updates.heightIn = heightIn == null ? null : String(heightIn);
  }

  const trainingYears = num(body?.trainingYears);
  if (trainingYears !== undefined) {
    if (trainingYears !== null && (trainingYears < 0 || trainingYears > 90)) {
      return NextResponse.json({ error: "trainingYears must be between 0 and 90" }, { status: 400 });
    }
    updates.trainingYears = trainingYears == null ? null : String(trainingYears);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  // Upsert the singleton. Every OTHER column has a NOT NULL default, so an
  // insert carrying only the touched fields is valid — which is exactly what
  // makes a partially filled form savable.
  await db
    .insert(profile)
    .values({ id: SINGLETON_ID, ...updates })
    .onConflictDoUpdate({ target: profile.id, set: updates });

  return GET();
}
