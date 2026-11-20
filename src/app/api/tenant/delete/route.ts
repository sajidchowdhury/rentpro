import { NextResponse } from "next/server";
import { deleteTenant } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Delete a tenant — but ONLY if they have no transactions (no collections,
// leases, advance adjustments, rent-change history, or waived months).
// The data layer enforces this guard and returns a clear error otherwise.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Valid tenant id is required" }, { status: 400 });
  }
  const result = deleteTenant(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
