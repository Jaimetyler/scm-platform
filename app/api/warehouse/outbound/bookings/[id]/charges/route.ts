import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { vendor } from "@/lib/dray/server";
import { bookingOrderCharges, bookingOrderMarks, readBookingMarkCharges } from "@/lib/dray/booking-charges";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { readDallasBookingOrders } from "@/lib/warehouse/outbound/planning-info";
import { readBookingCustomerRate } from "@/lib/dray/booking-customer-rate";
import { mapLimit } from "@/lib/http/map-limit";

export const maxDuration = 120;

export const GET = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid booking." }, { status: 400 });
  const db = staffDatabase();
  const booking = await db.from("cotton_outbound_bookings").select("terminal,site_code,customer,booking_number,return_location,return_location_code").eq("id", id).maybeSingle();
  if (booking.error) return NextResponse.json({ ok: false, error: "Could not load booking." }, { status: 503 });
  const site = CHECKIN_SITES.find(site => site.terminal === "DAL" && site.terminal === booking.data?.terminal && site.siteCode === booking.data.site_code);
  const customer = bookingChargeCustomer(String(booking.data?.customer ?? ""));
  if (!site || !customer) {
    return NextResponse.json({ ok: false, error: "Choose a supported Dallas dray booking." }, { status: 404 });
  }
  let applicable;
  try { applicable = await readBookingCustomerRate(db, booking.data!); }
  catch { return NextResponse.json({ ok: false, error: "Customer rate lookup is unavailable. Retry before reviewing extras." }, { status: 503 }); }
  if (customer.code === "BUNGOMNE" && !applicable) return NextResponse.json({ ok: false, error: "Customer rate lookup is unavailable. Retry before reviewing extras." }, { status: 503 });
  const approvalRate = applicable ? { rateCode: applicable.rate_code, includedChassisDays: Number(applicable.included_chassis_days),
    chassisDailyRate: Number(applicable.chassis_daily_rate), fuelMode: applicable.fuel_mode,
    baseRate: applicable.base_rate === null ? null : Number(applicable.base_rate) } : null;
  const lines = await db.from("cotton_outbound_booking_lines").select("mark").eq("booking_id", id).neq("line_status", "cancelled").limit(501);
  if (lines.error || !lines.data || lines.data.length > 500) {
    return NextResponse.json({ ok: false, error: "Could not load a complete set of booking marks." }, { status: 503 });
  }
  const marks = [...new Set(lines.data.map(line => String(line.mark ?? "").trim()).filter(Boolean))];
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(75_000)]);
  const read = vendor(true).read;
  const bookingNumber = booking.data!.booking_number;
  const byMark = new Map<string, ReturnType<typeof bookingOrderCharges>[]>();
  const unmatchedOrders: ReturnType<typeof bookingOrderCharges>[] = [];
  let bookingLookupIncomplete = false;
  try {
    const bookingOrders = await readDallasBookingOrders(read, bookingNumber, site, customer.ids, signal);
    for (const order of bookingOrders) {
      const matchingMarks = bookingOrderMarks(order, marks);
      const charges = bookingOrderCharges(order);
      if (!matchingMarks.length) unmatchedOrders.push(charges);
      for (const mark of matchingMarks) {
        const orders = byMark.get(mark) ?? [];
        orders.push(charges);
        byMark.set(mark, orders);
      }
    }
  } catch { bookingLookupIncomplete = true; }
  const results = await mapLimit(marks, 3, async mark => {
    const exactOrders = byMark.get(mark);
    if (exactOrders?.length) return { mark, orders: exactOrders };
    try {
      const orders = await readBookingMarkCharges(read, site, mark, signal, customer.ids, bookingNumber);
      return { mark, orders, ...(!orders.length && bookingLookupIncomplete ? { error: "Booking lookup incomplete. Retry before using these charges." } : {}) };
    } catch { return { mark, orders: [], error: "McLeod lookup incomplete. Retry before using these charges." }; }
  });
  const matchedIds = new Set(results.flatMap(result => result.orders.map(order => order.id)));
  const unassigned = unmatchedOrders.filter(order => !matchedIds.has(order.id));
  if (unassigned.length) results.push({ mark: "Booking match · mark unverified", orders: unassigned });
  return NextResponse.json({ ok: true, results, approvalRate, negotiatedFuel: approvalRate?.fuelMode === "base_plus_fsc" }, { headers: { "Cache-Control": "no-store" } });
});
