import { NextResponse } from "next/server";
import { runDataMigration } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = runDataMigration();
  if (!result.ok) {
    return NextResponse.json({ error: "Migration failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, summary: result.summary });
}
