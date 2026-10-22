import { NextResponse } from "next/server";
import { addRentChange } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const leaseId = Number(body.leaseId);
  if (!Number.isFinite(leaseId) || leaseId <= 0) {
    return NextResponse.json({ error: "Valid leaseId is required" }, { status: 400 });
  }
  const result = addRentChange(
    leaseId,
    String(body.effectiveDate ?? ""),
    Number(body.rent ?? 0),
    Number(body.gasBill ?? 0),
    Number(body.moylarBill ?? 0),
    Number(body.serviceCharge ?? 0),
    Number(body.otherBill ?? 0),
    String(body.reason ?? "")
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
