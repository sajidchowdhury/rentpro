import { NextResponse } from "next/server";
import { recordExpenseBatch } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  const result = recordExpenseBatch(
    items.map((it: any) => ({
      accountHeadId: Number(it.accountHeadId),
      month: String(it.month ?? ""),
      year: String(it.year ?? ""),
      amount: Number(it.amount ?? 0),
      date: it.date ?? new Date().toISOString(),
      note: String(it.note ?? ""),
    }))
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }
  return NextResponse.json({ ok: true, recorded: items.length });
}
