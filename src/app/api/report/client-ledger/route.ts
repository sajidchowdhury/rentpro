import { NextResponse } from "next/server";
import { getClientLedgerStatement } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = Number(searchParams.get("tenantId"));
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  const fromMonth = searchParams.get("fromMonth") ?? undefined;
  const fromYear = searchParams.get("fromYear") ?? undefined;
  if (!tenantId || !month || !year) {
    return NextResponse.json({ error: "tenantId, month and year are required" }, { status: 400 });
  }
  const result = getClientLedgerStatement(tenantId, month, year, fromMonth, fromYear);
  if (!result) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
