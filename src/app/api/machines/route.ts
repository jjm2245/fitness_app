import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { machines } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(machines).orderBy(machines.id);
  return NextResponse.json(rows);
}

// Lets the logging screen register a machine in one tap instead of requiring
// it to pre-exist (spec §16's "machine identification UX" friction point).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const trimmedId = id.trim();

  const [row] = await db
    .insert(machines)
    .values({ id: trimmedId, notes: typeof body?.notes === "string" ? body.notes : null })
    .onConflictDoNothing()
    .returning();

  if (row) return NextResponse.json(row, { status: 201 });

  const [existing] = await db.select().from(machines).where(eq(machines.id, trimmedId));
  return NextResponse.json(existing, { status: 200 });
}
