import { NextResponse } from "next/server";
import { getOrganizations, createOrganization } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ organizations: getOrganizations() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = createOrganization({
    name: String(body.name ?? ""),
    shortName: body.shortName,
    plan: body.plan,
    currency: body.currency,
    defaultLocale: body.defaultLocale,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
