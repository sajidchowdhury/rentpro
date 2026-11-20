import { NextResponse } from "next/server";
import { getLeaseRentChanges } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// List all rent-change history entries for a lease (oldest first), so the
// rent-change dialog can show existing changes + let the user delete a wrong one.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leaseId = Number(searchParams.get("leaseId") ?? "0");
  if (!Number.isFinite(leaseId) || leaseId <= 0) {
    return NextResponse.json({ error: "Valid leaseId is required" }, { status: 400 });
  }
  return NextResponse.json({ changes: getLeaseRentChanges(leaseId) });
}
