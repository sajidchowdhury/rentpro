import { NextResponse } from "next/server";
import { deleteExpense } from "@/lib/rentData";

export const dynamic = "force-dynamic";

// Delete a single expense record. Mirrors /api/collect/delete. The data layer
// (deleteExpense) removes BOTH the expense record AND its linked ledger
// transaction, so the dashboard cash flow, day book, yearly report and
// account-head report all reflect the deletion.
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
  const result = deleteExpense(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
