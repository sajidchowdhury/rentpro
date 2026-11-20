import { NextResponse } from "next/server";
import { updateTenant } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Edit a tenant's name / code / mobile / family member / status.
// Mirrors the shape of /api/collect/update.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Valid tenant id is required" }, { status: 400 });
  }
  const result = updateTenant({
    id,
    name: body.name !== undefined ? String(body.name) : undefined,
    code: body.code !== undefined ? String(body.code) : undefined,
    mobile: body.mobile !== undefined ? (body.mobile ?? null) : undefined,
    familyMember: body.familyMember !== undefined ? (body.familyMember ?? null) : undefined,
    status: body.status === "ACTIVE" || body.status === "GONE" ? body.status : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
