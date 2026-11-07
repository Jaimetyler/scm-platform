import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { vendor } from "@/lib/dray/server";
import { readBookingMarkCharges } from "@/lib/dray/booking-charges";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { mapLimit } from "@/lib/http/map-limit";

export const maxDuration = 120;

export const GET = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid booking." }, { status: 400 });
  const db = staffDatabase();
  const booking = await db.from("cotton_outbound_bookings").select("terminal,site_code,customer").eq("id", id).maybeSingle();
  if (booking.error) return NextResponse.json({ ok: false, error: "Could not load booking." }, { status: 503 });
  const site = CHECKIN_SITES.find(site => site.terminal === "DAL" && site.terminal === booking.data?.terminal && site.siteCode === booking.data.site_code);
  if (!site || !/^BUNGE USA AGRICULTURE\s*,?\s+LLC\.?$/i.test(String(booking.data?.customer ?? ""))) {
    return NextResponse.json({ ok: false, error: "Choose a Dallas Bunge booking." }, { status: 404 });
  }
  const rate = await db.from("customer_service_rates")
    .select("included_chassis_days,chassis_daily_rate")
    .eq("terminal", "DAL").eq("customer_code", "BUNGOMNE")
    .eq("revenue_code", "DDRAY").eq("service_type", "drayage").eq("active", true).maybeSingle();
  if (rate.error || !rate.data) return NextResponse.json({ ok: false, error: "Bunge Dallas rate rule is unavailable. Retry before reviewing extras." }, { status: 503 });
  const approvalRate = { includedChassisDays: Number(rate.data.included_chassis_days), chassisDailyRate: Number(rate.data.chassis_daily_rate) };
  const lines = await db.from("cotton_outbound_booking_lines").select("mark").eq("booking_id", id).neq("line_status", "cancelled").limit(501);
  if (lines.error || !lines.data || lines.data.length > 500) {
    return NextResponse.json({ ok: false, error: "Could not load a complete set of booking marks." }, { status: 503 });
  }
  const marks = [...new Set(lines.data.map(line => String(line.mark ?? "").trim()).filter(Boolean))];
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(75_000)]);
  const read = vendor(true).read;
  const results = await mapLimit(marks, 3, async mark => {
    try { return { mark, orders: await readBookingMarkCharges(read, site, mark, signal) }; }
    catch { return { mark, orders: [], error: "McLeod lookup incomplete. Retry before using these charges." }; }
  });
  return NextResponse.json({ ok: true, results, approvalRate }, { headers: { "Cache-Control": "no-store" } });
});
