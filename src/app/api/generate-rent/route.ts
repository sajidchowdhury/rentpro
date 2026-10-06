import { NextResponse } from "next/server";
import { getGeneratePreview, markMonthGenerated } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!month || !year) {
    return NextResponse.json(
      { error: "month and year query params are required" },
      { status: 400 }
    );
  }
  return NextResponse.json(getGeneratePreview(month, year));
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!month || !year) {
    return NextResponse.json(
      { error: "month and year query params are required" },
      { status: 400 }
    );
  }
  // Prototype: mark the month as generated in-memory. In production this
  // inserts idempotent rent_schedule rows (one per active lease) into Postgres,
  // guarded by @@unique([leaseId, month, year]).
  markMonthGenerated(month, year);
  return NextResponse.json({
    ok: true,
    message: `Rent for ${month} ${year} generated.`,
    preview: getGeneratePreview(month, year),
  });
}
