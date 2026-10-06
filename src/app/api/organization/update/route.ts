import { NextResponse } from "next/server";
import { updateOrganization } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const result = updateOrganization(String(body.id ?? ""), {
    name: body.name,
    shortName: body.shortName,
    address: body.address,
    phone: body.phone,
    email: body.email,
    currency: body.currency,
    defaultLocale: body.defaultLocale,
    plan: body.plan,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
