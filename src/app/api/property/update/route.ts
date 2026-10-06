import { NextResponse } from "next/server";
import { updateProperty } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const result = updateProperty(Number(body.id), String(body.name ?? ""), String(body.type ?? "BUILDING"));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
