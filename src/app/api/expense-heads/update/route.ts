import { NextResponse } from "next/server";
import { updateAccountHead } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Valid id is required" }, { status: 400 });
  }
  const type = (["INCOME", "EXPENSE", "BOTH", "ASSET", "LIABILITY"].includes(String(body.type)))
    ? (String(body.type) as "INCOME" | "EXPENSE" | "BOTH" | "ASSET" | "LIABILITY")
    : "EXPENSE";
  const result = updateAccountHead(
    id,
    String(body.name ?? ""),
    type,
    Boolean(body.recurringMonthly)
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
