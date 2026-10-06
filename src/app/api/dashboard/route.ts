import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/rentData";

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
  const data = getDashboard(month, year);
  const serialized = {
    ...data,
    recentCollections: data.recentCollections.map((c) => ({
      ...c,
      receiveDate: c.receiveDate ? c.receiveDate.toISOString() : null,
    })),
  };
  return NextResponse.json(serialized);
}
