import type { NextRequest } from "next/server";
import { GET as runInterchanges } from "../savannah-interchanges/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(request: NextRequest) {
  const now = Date.now();
  if (now < Date.parse("2026-11-19T13:30:00Z") || now >= Date.parse("2026-11-19T15:00:00Z")) {
    return new Response(null, { status: 204 });
  }
  return runInterchanges(request);
}
