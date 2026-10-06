import { NextResponse } from "next/server";
import { getExpenseHeads } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ heads: getExpenseHeads() });
}
