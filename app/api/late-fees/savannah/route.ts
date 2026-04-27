import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    count: 0,
    rows: [],
    note: "Savannah late fees route scaffold is live. McLeod pull still needs to be wired in.",
  });
}