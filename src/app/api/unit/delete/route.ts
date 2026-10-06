import { NextResponse } from "next/server";
import { deleteUnit } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const result = deleteUnit(Number(body.id));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
