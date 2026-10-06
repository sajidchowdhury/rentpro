import { NextResponse } from "next/server";
import { settleLease } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = settleLease({
    leaseId: Number(body.leaseId),
    vacateDate: body.vacateDate ?? new Date().toISOString().slice(0, 10),
    advanceAdjusted: Number(body.advanceAdjusted ?? 0),
    advanceRefunded: Number(body.advanceRefunded ?? 0),
    note: String(body.note ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, settlement: result.settlement });
}
