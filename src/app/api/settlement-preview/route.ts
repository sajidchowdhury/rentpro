import { NextResponse } from "next/server";
import { getSettlementPreview } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const leaseId = Number(searchParams.get("leaseId"));
  const vacateDate = searchParams.get("vacateDate") ?? new Date().toISOString().slice(0, 10);
  if (!leaseId) {
    return NextResponse.json({ error: "leaseId is required" }, { status: 400 });
  }
  const result = getSettlementPreview(leaseId, vacateDate);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
