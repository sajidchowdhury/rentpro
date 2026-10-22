import { NextResponse } from "next/server";
import { importState } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = importState(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: "State restored successfully" });
}
