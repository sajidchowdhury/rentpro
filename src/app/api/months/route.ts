import { NextResponse } from "next/server";
import { getAvailableMonths } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ months: getAvailableMonths() });
}
