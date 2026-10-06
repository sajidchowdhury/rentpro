import { NextResponse } from "next/server";
import { getPropertyTypes, getUnitTypes } from "@/lib/rentData";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    propertyTypes: getPropertyTypes(),
    unitTypes: getUnitTypes(),
  });
}
