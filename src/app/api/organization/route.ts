import { NextResponse } from "next/server";
import { getActiveOrg, activeOrgOwnsData } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ organization: getActiveOrg(), ownsData: activeOrgOwnsData() });
}
