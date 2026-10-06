import { NextResponse } from "next/server";
import { getYearlyReport } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year") ?? String(new Date().getFullYear());
  return NextResponse.json(getYearlyReport(year));
}
