import { NextResponse } from "next/server";
import { getClientDueReport } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!month || !year) {
    return NextResponse.json({ error: "month and year are required" }, { status: 400 });
  }
  return NextResponse.json(getClientDueReport(month, year));
}
