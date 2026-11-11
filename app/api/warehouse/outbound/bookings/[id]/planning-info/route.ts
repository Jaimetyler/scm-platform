import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { vendor } from "@/lib/dray/server";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { readPlanningInfo } from "@/lib/warehouse/outbound/planning-info";

export const runtime = "nodejs";
export const maxDuration = 120;
export const GET = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid booking." }, { status: 400 });
  const result = await staffDatabase().from("cotton_outbound_bookings")
    .select("booking_number,terminal,site_code,customer,planned_containers").eq("id", id).maybeSingle();
  if (result.error) return NextResponse.json({ ok: false, error: "Booking lookup unavailable." }, { status: 503 });
  if (!result.data) return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
  const booking = result.data;
  const site = CHECKIN_SITES.find(site => site.terminal === "DAL" && site.terminal === booking.terminal && site.siteCode === booking.site_code);
  const customer = bookingChargeCustomer(booking.customer);
  if (!site || !customer) return NextResponse.json({ ok: false, error: "Carrier lookup is available for supported Dallas dray customers." }, { status: 400 });
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(75_000)]);
    const read = vendor(true).read;
    const info = await readPlanningInfo(async path => { signal.throwIfAborted(); const value = await read(path); signal.throwIfAborted(); return value; }, booking, site, customer.ids, signal);
    return NextResponse.json({ ok: true, info }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "McLeod lookup incomplete. Refresh this booking again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
