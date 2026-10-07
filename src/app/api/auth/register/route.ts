import { NextResponse } from "next/server";
import { registerUser } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = registerUser({
    username: String(body.username ?? ""),
    password: String(body.password ?? ""),
    displayName: String(body.displayName ?? body.username ?? ""),
    orgName: String(body.orgName ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, userId: result.userId, orgId: result.orgId });
}
