import { NextResponse } from "next/server";
import { getRentSummaryReport } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Export the Rent Summary as an Excel-compatible file (.xls / HTML table)
// matching the user's spreadsheet layout: per-tenant rows with Sl, Name,
// Rent, Month, Total + a side summary (Other Income, Rent Collection, TOTAL,
// Expense, Left, Bank, Cash in Hand).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!month || !year) {
    return NextResponse.json({ error: "month and year are required" }, { status: 400 });
  }

  const report = getRentSummaryReport(month, year);

  // Each RentSummaryRow is per-lease (a tenant with 2 leases = 2 rows).
  // The user's sheet shows rent + months paid + total per row, which maps
  // directly to monthlyRent × monthsPaid.
  interface Row { sl: number; name: string; rent: number; months: number; total: number; }
  const rows: Row[] = report.rows.map((r, i) => ({
    sl: i + 1,
    name: `${r.tenantName} (${r.tenantCode})`,
    rent: r.monthlyRent,
    months: r.monthsPaid,
    total: r.monthlyRent * r.monthsPaid,
  }));

  // Side summary (computed from ds.txns — matches Day Book)
  const summary = {
    otherIncome: report.totalOtherIncome,
    rentCollection: report.totalRentCollection,
    total: report.totalRentCollection + report.totalOtherIncome,
    expense: report.totalExpense,
    left: report.totalRentCollection + report.totalOtherIncome - report.totalExpense,
    bank: report.closingBank,
    cashInHand: report.cashInHand,
  };

  const rowHtml = rows.map((r) =>
    `<tr><td>${r.sl}</td><td>${r.name}</td><td>${r.rent}</td><td>${r.months}</td><td>${r.total}</td></tr>`
  ).join("");
  const totalAmount = rows.reduce((s, r) => s + r.total, 0);

  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>td, th { border: 1px solid #ccc; padding: 4px 8px; font-family: Arial; font-size: 11px; } th { background: #f0f0f0; font-weight: bold; } .r { text-align: right; }</style></head><body><table cellspacing="0">
<tr><th>Sl</th><th>Name</th><th>Rent</th><th>Month</th><th>Total</th><th></th><th></th><th></th><th></th><th></th><th></th></tr>
${rowHtml}
<tr><td></td><td></td><td></td><td></td><td>${totalAmount}</td><td></td><td></td><td></td><td></td><td>Other Income</td><td>${summary.otherIncome}</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>Rent Collection</td><td>${summary.rentCollection}</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>TOTAL</td><td>${summary.total}</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>Expense</td><td>${summary.expense}</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>Left</td><td>${summary.left}</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>Bank</td><td>${summary.bank}</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>Cash in Hand</td><td>${summary.cashInHand}</td></tr>
</table></body></html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="rent-summary-${month}-${year}.xls"`,
    },
  });
}
