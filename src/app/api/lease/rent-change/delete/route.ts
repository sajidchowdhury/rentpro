import { NextResponse } from "next/server";
import { deleteRentChange } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Delete a single rent-change entry from a lease's history, identified by its
// effectiveDate. Lets the user remove a wrongly-recorded rent change (e.g. the
// wrong year was picked). The data layer re-syncs the lease's current rent.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const leaseId = Number(body.leaseId);
  if (!Number.isFinite(leaseId) || leaseId <= 0) {
    return NextResponse.json({ error: "Valid leaseId is required" }, { status: 400 });
  }
  const effectiveDate = String(body.effectiveDate ?? "");
  if (!effectiveDate) {
    return NextResponse.json({ error: "effectiveDate is required" }, { status: 400 });
  }
  const result = deleteRentChange(leaseId, effectiveDate);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
