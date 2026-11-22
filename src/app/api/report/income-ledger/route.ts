import { NextResponse } from "next/server";
import { getIncomeLedgerReport } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Income Ledger report: every individual income transaction (not aggregated),
// filterable by multiple account heads + a date range. Mirrors the Expense
// Ledger report. Shows all income (rent collections + other income).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const headIdsRaw = searchParams.get("headIds") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const headIds: number[] = headIdsRaw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return NextResponse.json(
    getIncomeLedgerReport({
      headIds: headIds.length > 0 ? headIds : undefined,
      fromDate: from || undefined,
      toDate: to || undefined,
    })
  );
}
