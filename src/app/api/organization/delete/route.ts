import { NextResponse } from "next/server";
import { deleteOrganization } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Delete an organization. The owner org (owns the loaded dump data) cannot be
// deleted. If the deleted org was the active one, the active org falls back to
// the owner org. Client orgs hold no data in the prototype (isolated), so
// deletion is safe.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id) {
    return NextResponse.json({ error: "Organization id is required" }, { status: 400 });
  }
  const result = deleteOrganization(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
