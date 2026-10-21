import { NextResponse } from "next/server";
import { unwaiaveLeaseMonth } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const leaseId = Number(body.leaseId);
  const month = String(body.month ?? "");
  const year = String(body.year ?? "");
  if (!Number.isFinite(leaseId) || !month || !year) {
    return NextResponse.json({ error: "leaseId, month, year are required" }, { status: 400 });
  }
  unwaiaveLeaseMonth(leaseId, month, year);
  return NextResponse.json({ ok: true });
}
