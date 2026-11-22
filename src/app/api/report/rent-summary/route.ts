import { NextResponse } from "next/server";
import { getRentSummaryReport } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Rent Summary report: per-tenant summary (months of rent, rent, total paid,
// due, advance deductions) + a cash-in-hand summary at the bottom. Used for
// the printable Rent Summary tab with clickable drill-down.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!month || !year) {
    return NextResponse.json({ error: "month and year are required" }, { status: 400 });
  }
  return NextResponse.json(getRentSummaryReport(month, year));
}
