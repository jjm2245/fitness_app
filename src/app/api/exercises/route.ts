import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { exercises } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(exercises).orderBy(exercises.day, exercises.name);
  return NextResponse.json(rows);
}
