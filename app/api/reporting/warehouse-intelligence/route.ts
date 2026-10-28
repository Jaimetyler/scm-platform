import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
export const dynamic = "force-dynamic";
export const GET = withStaffAccess(async () => {
  const { data, error } = await staffDatabase().from("scm_reporting_snapshots")
    .select("customers,source_date")
    .eq("id", "warehouse-intelligence-20261028-trucking").single();
  if (error || !Array.isArray(data?.customers))
    return NextResponse.json({ ok: false, error: "Financial report is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ customers: data.customers, sourceDate: data.source_date },
    { headers: { "Cache-Control": "private, no-store" } });
});
