import { NextResponse } from "next/server";
import { reloadDataSource, getActiveOrg, activeOrgOwnsData } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Re-scans for the legacy dump (findDump) and reloads the in-memory dataset
// — so you can mount the dump and pick it up without a server restart.
export async function POST() {
  const dataSource = reloadDataSource();
  return NextResponse.json({
    ok: true,
    dataSource,
    ownsData: activeOrgOwnsData(),
    organization: getActiveOrg(),
  });
}
