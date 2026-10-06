import { NextResponse } from "next/server";
import { addUnit } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const result = addUnit(
    Number(body.propertyId),
    String(body.name ?? ""),
    String(body.type ?? "ROOM"),
    Number(body.defaultRent ?? 0),
    String(body.notes ?? "")
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
