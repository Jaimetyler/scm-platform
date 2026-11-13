import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { saveCarrierRate } from "@/lib/warehouse/outbound/carrier-rate-store";

export const POST = withStaffAccess(async (req: NextRequest) => {
  const site = getCheckinSite(req.nextUrl.searchParams.get("terminal") ?? "", req.nextUrl.searchParams.get("siteCode") ?? "");
  if (!site?.materials.includes("cotton")) {
    return NextResponse.json({ error: "Choose a cotton warehouse." }, { status: 400 });
  }
  return saveCarrierRate(req, { terminal: site.terminal, site_code: site.siteCode });
});
