import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import report from "@/lib/reporting/warehouse-intelligence-data.json";
export const dynamic = "force-dynamic";
export const GET = withStaffAccess(async () =>
  NextResponse.json({ customers: report }, { headers: { "Cache-Control": "private, no-store" } })
);
