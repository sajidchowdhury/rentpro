import { NextResponse } from "next/server";
import { exportState } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = exportState();
  const json = JSON.stringify(state, null, 2);
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rentpro-backup-${ts}.json"`,
    },
  });
}
