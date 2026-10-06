import { NextResponse } from "next/server";
import { recordExpense } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = recordExpense({
    accountHeadId: Number(body.accountHeadId),
    month: String(body.month ?? ""),
    year: String(body.year ?? ""),
    amount: Number(body.amount ?? 0),
    date: body.date ?? new Date().toISOString(),
    note: String(body.note ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
