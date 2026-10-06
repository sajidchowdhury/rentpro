import { NextResponse } from "next/server";
import { getDayBook } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  return NextResponse.json(getDayBook(from, to));
}
