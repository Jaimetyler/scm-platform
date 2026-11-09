import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
export const runtime = "nodejs";
export const GET = withStaffAccess(async (req: NextRequest) => {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") || "").trim();
  const staff = staffProfile(req);
  const requested = (params.get("terminal") || "all").toUpperCase();
  const terminal = requested === "ALL" ? staff?.role === "operator" ? staff.terminal : null : requested;
  const site = params.get("siteCode") || null;
  if (q.length < 2 || q.length > 100 || terminal && !["HOU", "SAV", "DAL"].includes(terminal) ||
      site && !CHECKIN_SITES.some(s => s.terminal === terminal && s.siteCode === site))
    return NextResponse.json({ ok: false, error: "Enter 2–100 characters and select a valid warehouse location." }, { status: 400 });
  const { data, error } = await staffDatabase().rpc("search_warehouse_operations", { p_query: q, p_terminal: terminal, p_site: site });
  if (error) return NextResponse.json({ ok: false, error: "Warehouse search is unavailable. Try again." }, { status: 503 });
  return NextResponse.json({ ok: true, results: data }, { headers: { "Cache-Control": "no-store" } });
});
