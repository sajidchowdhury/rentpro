import { NextResponse } from "next/server";
import { getGeneratePreview, generateRentForAll, generateRentForTenant, markMonthGenerated } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  const tenantId = searchParams.get("tenantId");
  if (!month || !year) {
    return NextResponse.json(
      { error: "month and year query params are required" },
      { status: 400 }
    );
  }
  // If tenantId is provided, preview only that tenant's leases
  const tid = tenantId ? Number(tenantId) : undefined;
  return NextResponse.json(getGeneratePreview(month, year, tid));
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? "";
  const year = searchParams.get("year") ?? "";
  if (!month || !year) {
    return NextResponse.json(
      { error: "month and year query params are required" },
      { status: 400 }
    );
  }
  const tenantId = searchParams.get("tenantId");
  const tid = tenantId ? Number(tenantId) : undefined;

  // Generate: create PENDING collections (invoices) for each active lease
  // covering this month that doesn't already have one (idempotent).
  if (tid !== undefined) {
    const r = generateRentForTenant(tid, month, year);
    markMonthGenerated(month, year);
    return NextResponse.json({
      ok: true,
      message: `${r.created} invoice${r.created !== 1 ? "s" : ""} created for ${month} ${year}${r.skipped > 0 ? ` · ${r.skipped} already existed` : ""}`,
      ...r,
      preview: getGeneratePreview(month, year, tid),
    });
  }
  const r = generateRentForAll(month, year);
  markMonthGenerated(month, year);
  return NextResponse.json({
    ok: true,
    message: `${r.created} invoice${r.created !== 1 ? "s" : ""} created for ${month} ${year} across ${r.tenantCount} tenants${r.skipped > 0 ? ` · ${r.skipped} already existed` : ""}`,
    ...r,
    preview: getGeneratePreview(month, year),
  });
}
