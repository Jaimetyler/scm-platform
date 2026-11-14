import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { vendor } from "@/lib/dray/server";
import { bookingOrderCharges, bookingOrderMarks, readBookingMarkCharges } from "@/lib/dray/booking-charges";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { readDallasBookingOrders } from "@/lib/warehouse/outbound/planning-info";
import { readBookingCustomerRate } from "@/lib/dray/booking-customer-rate";
import { buildBookingSyncPreview } from "@/lib/warehouse/outbound/booking-sync-preview";
import { mapLimit } from "@/lib/http/map-limit";

export const maxDuration = 120;

export const GET = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid booking." }, { status: 400 });
  const db = staffDatabase();
  const booking = await db.from("cotton_outbound_bookings").select("terminal,site_code,customer,booking_number,customer_reference,return_location,return_location_code").eq("id", id).maybeSingle();
  if (booking.error) return NextResponse.json({ ok: false, error: "Could not load booking." }, { status: 503 });
  const site = CHECKIN_SITES.find(site => site.terminal === "DAL" && site.terminal === booking.data?.terminal && site.siteCode === booking.data.site_code);
  const customer = bookingChargeCustomer(String(booking.data?.customer ?? ""));
  if (!site || !customer) {
    return NextResponse.json({ ok: false, error: "Choose a supported Dallas dray booking." }, { status: 404 });
  }
  if (req.nextUrl.searchParams.get("view") === "booking-preview") {
    const scope = booking.data!;
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(75_000)]);
    const [containers, marks, verified, imported, rate] = await Promise.all([
      db.from("cotton_outbound_containers").select("id,sequence_no,container_number,booking_line_id,carrier_plan")
        .eq("booking_id", id).is("split_transfer_id", null).order("sequence_no").limit(501),
      db.from("cotton_outbound_booking_lines").select("id,mark,line_status").eq("booking_id", id).limit(501),
      db.from("dallas_outbound_pilot_writes").select("container_number,order_id")
        .eq("booking_number", scope.booking_number.trim().toUpperCase()).eq("state", "verified").limit(501),
      db.from("dallas_dray_import_loads").select("sequence_no,order_id").eq("booking_id", id).eq("state", "verified").limit(501),
      readBookingCustomerRate(db, scope).catch(() => null),
    ]);
    if ([containers, marks, verified, imported].some(result => result.error || !result.data || result.data.length >= 501)) {
      return NextResponse.json({ error: "Could not load a complete set of booking loads." }, { status: 503 });
    }
    const marksById = new Map(marks.data!.map(line => [line.id, line]));
    const savedOrders = new Map(verified.data!.map(row => [row.container_number, row.order_id]));
    const importedOrders = new Map(imported.data!.map(row => [row.sequence_no, row.order_id]));
    const loads = containers.data!.flatMap(row => {
      const line = marksById.get(row.booking_line_id);
      if (line?.line_status === "cancelled") return [];
      return [{ id: row.id, sequence: row.sequence_no, mark: line?.mark ?? null,
        container: row.container_number, plan: row.carrier_plan,
        savedOrderId: importedOrders.get(row.sequence_no) ?? savedOrders.get(String(row.container_number ?? "").trim().toUpperCase()) ?? undefined }];
    });
    const cents = (value: number | null) => value == null ? null : Math.round(Number(value) * 100);
    const billing = rate ? {
      base: rate.fuel_mode === "all_in" ? cents(rate.base_rate) : null,
      minimumChassisDays: Number(rate.included_chassis_days),
      chassisDays: cents(rate.chassis_daily_rate), chassisSplits: cents(rate.chassis_split_rate),
      stopoffs: cents(rate.stopoff_rate),
    } : null;
    try {
      const orders = await readDallasBookingOrders(vendor(true).read, scope.booking_number, site, customer.ids, signal);
      return NextResponse.json(buildBookingSyncPreview(loads, orders, scope.customer_reference, billing), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch {
      return NextResponse.json({ error: "McLeod booking lookup could not be completed. Retry the preview." }, { status: 502 });
    }
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
