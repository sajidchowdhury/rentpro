import { NextResponse } from "next/server";
import { getExpenseHeads, getAllAccountHeads, createAccountHead } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ heads: getExpenseHeads(), allHeads: getAllAccountHeads() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const type = (["INCOME", "EXPENSE", "BOTH", "ASSET", "LIABILITY"].includes(String(body.type)))
    ? (String(body.type) as "INCOME" | "EXPENSE" | "BOTH" | "ASSET" | "LIABILITY")
    : "EXPENSE";
  const result = createAccountHead(
    String(body.name ?? ""),
    type,
    Boolean(body.recurringMonthly)
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
