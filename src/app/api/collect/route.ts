import { NextResponse } from "next/server";
import { collectRent } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = collectRent({
    tenantId: Number(body.tenantId),
    leaseId: Number(body.leaseId),
    month: String(body.month ?? ""),
    year: String(body.year ?? ""),
    rent: Number(body.rent ?? 0),
    gasBill: Number(body.gasBill ?? 0),
    serviceCharge: Number(body.serviceCharge ?? 0),
    otherBill: Number(body.otherBill ?? 0),
    method: body.method ?? "CASH",
    advanceAdjust: Number(body.advanceAdjust ?? 0),
    payLater: Boolean(body.payLater),
    note: String(body.note ?? ""),
    receiveDate: body.receiveDate ?? new Date().toISOString(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
