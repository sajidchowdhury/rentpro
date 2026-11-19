import { NextResponse } from "next/server";
import { updateExpense } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Edit a single expense record. Mirrors /api/collect/update. The data layer
// (updateExpense) keeps BOTH the expense record AND its linked ledger
// transaction in sync, so every report stays correct.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Valid expense id is required" }, { status: 400 });
  }

  const method =
    body.method === "BANK" || body.method === "MOBILE_BANK" || body.method === "CASH"
      ? body.method
      : undefined;

  const result = updateExpense({
    id,
    accountHeadId: body.accountHeadId !== undefined ? Number(body.accountHeadId) : undefined,
    amount: body.amount !== undefined ? Number(body.amount) : undefined,
    date: body.date !== undefined ? (body.date || undefined) : undefined,
    month: body.month !== undefined ? String(body.month) : undefined,
    year: body.year !== undefined ? String(body.year) : undefined,
    note: body.note !== undefined ? String(body.note ?? "") : undefined,
    method,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
