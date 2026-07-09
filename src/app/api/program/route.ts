import { NextResponse } from "next/server";
import { getActiveProgram, getProgramWithDays } from "@/lib/programs";

// Day order comes entirely from program_days.order_index (real data the user
// can reorder in the editor) — no hardcoded day-tag vocabulary here anymore.
export async function GET() {
  const program = await getActiveProgram();
  if (!program) {
    return NextResponse.json({ error: "No active program" }, { status: 404 });
  }

  const full = await getProgramWithDays(program.id);
  return NextResponse.json(full);
}
