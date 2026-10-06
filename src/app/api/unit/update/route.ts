import { NextResponse } from "next/server";
import { updateUnit } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const result = updateUnit(
    Number(body.id),
    String(body.name ?? ""),
    String(body.type ?? "ROOM"),
    Number(body.defaultRent ?? 0),
    String(body.notes ?? ""),
    String(body.status ?? "VACANT")
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
