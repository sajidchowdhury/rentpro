import { NextResponse } from "next/server";
import { splitUnit } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const unitId = Number(body.unitId);
  if (!Number.isFinite(unitId) || unitId <= 0) {
    return NextResponse.json({ error: "Valid unitId is required" }, { status: 400 });
  }
  const result = splitUnit({
    unitId,
    originalNewName: String(body.originalNewName ?? ""),
    originalNewRent: body.originalNewRent !== undefined && body.originalNewRent !== "" ? Number(body.originalNewRent) : undefined,
    originalNewGasBill: Number(body.originalNewGasBill ?? 0) || undefined,
    originalNewServiceCharge: Number(body.originalNewServiceCharge ?? 0) || undefined,
    originalNewOtherBill: Number(body.originalNewOtherBill ?? 0) || undefined,
    newUnitName: String(body.newUnitName ?? ""),
    newUnitType: String(body.newUnitType ?? ""),
    newUnitDefaultRent: Number(body.newUnitDefaultRent ?? 0),
    effectiveDate: String(body.effectiveDate ?? ""),
    reason: String(body.reason ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, newUnitId: result.newUnitId });
}
