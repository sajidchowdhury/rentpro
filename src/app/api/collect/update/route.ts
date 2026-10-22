import { NextResponse } from "next/server";
import { updateCollection } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Valid collection id is required" }, { status: 400 });
  }
  const result = updateCollection({
    id,
    rent: body.rent !== undefined ? Number(body.rent) : undefined,
    gasBill: body.gasBill !== undefined ? Number(body.gasBill) : undefined,
    moylarBill: body.moylarBill !== undefined ? Number(body.moylarBill) : undefined,
    serviceCharge: body.serviceCharge !== undefined ? Number(body.serviceCharge) : undefined,
    otherBill: body.otherBill !== undefined ? Number(body.otherBill) : undefined,
    rentMonth: body.rentMonth !== undefined ? String(body.rentMonth) : undefined,
    rentYear: body.rentYear !== undefined ? String(body.rentYear) : undefined,
    receiveDate: body.receiveDate !== undefined ? (body.receiveDate || null) : undefined,
    status: body.status === "DONE" || body.status === "PENDING" ? body.status : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
