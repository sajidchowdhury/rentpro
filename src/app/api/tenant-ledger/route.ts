import { NextResponse } from "next/server";
import { getTenantLedger } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = Number(searchParams.get("tenantId"));
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!tenantId || !month || !year) {
    return NextResponse.json(
      { error: "tenantId, month and year query params are required" },
      { status: 400 }
    );
  }
  const ledger = getTenantLedger(tenantId, month, year);
  if (!ledger) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }
  return NextResponse.json(ledger);
}
