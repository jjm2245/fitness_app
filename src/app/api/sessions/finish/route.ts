import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { workoutLogs } from "@/db/schema";

// Stamp a session finished (spec §7a). Idempotent by date and re-stampable —
// "finish" means "here's the summary, everything's saved," never a locked
// session. Upserts the workout_log so finishing a session that only ever
// existed offline (no set synced yet, so no workout_log row) still works.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const date = body?.date;
  if (typeof date !== "string" || date.trim() === "") {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  const finishedAt = typeof body?.finishedAt === "string" ? new Date(body.finishedAt) : new Date();

  const [existing] = await db.select().from(workoutLogs).where(eq(workoutLogs.date, date));

  let row;
  if (existing) {
    [row] = await db
      .update(workoutLogs)
      .set({ finishedAt })
      .where(eq(workoutLogs.id, existing.id))
      .returning();
  } else {
    [row] = await db.insert(workoutLogs).values({ date, finishedAt }).returning();
  }

  return NextResponse.json(row);
}
