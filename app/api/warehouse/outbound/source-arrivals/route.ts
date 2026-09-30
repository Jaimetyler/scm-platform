import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const terminal = String(params.get("terminal") ?? "").toUpperCase(), siteCode = String(params.get("siteCode") ?? "");
    if ((terminal || siteCode) && !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown cotton warehouse" }, { status: 400 });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    let query = createClient(url, key).from("cotton_outbound_source_arrivals")
      .select("id,mark,checkin_id,arrival_site_name,arrival_terminal,arrival_site_code,created_at,line:cotton_outbound_booking_lines!inner(id,line_status,booking:cotton_outbound_bookings!inner(id,booking_number,terminal,site_code,status))")
      .is("resolved_at", null).neq("line.line_status", "cancelled").eq("line.booking.status", "draft");
    if (terminal) query = query.eq("arrival_terminal", terminal).eq("arrival_site_code", siteCode);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return NextResponse.json({ ok: true, arrivals: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return NextResponse.json({ ok: false, error: reason instanceof Error ? reason.message : "Could not load source-load alerts" }, { status: 500 });
  }
}
