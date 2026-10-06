import { NextResponse } from "next/server";
import { getProperties, addProperty } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ properties: getProperties() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = addProperty(String(body.name ?? ""), String(body.type ?? "BUILDING"));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
