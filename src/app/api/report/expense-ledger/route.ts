import { NextResponse } from "next/server";
import { getExpenseLedgerReport } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Expense Ledger report: every individual expense record (not aggregated),
// filterable by multiple account heads + an optional date range. Each row
// carries its stable id so the UI renders per-row Edit / Delete actions.
//
// Query params:
//   headIds  — comma-separated account-head ids (e.g. ?headIds=4,5,6).
//               Omit to list expenses for ALL heads.
//   from     — ISO date (YYYY-MM-DD). Inclusive lower bound on recorded date.
//   to       — ISO date (YYYY-MM-DD). Inclusive upper bound on recorded date.
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
    getExpenseLedgerReport({
      headIds: headIds.length > 0 ? headIds : undefined,
      fromDate: from || undefined,
      toDate: to || undefined,
    })
  );
}
