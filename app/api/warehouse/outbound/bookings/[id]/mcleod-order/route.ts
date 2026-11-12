import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { bookingOrderCharges } from "@/lib/dray/booking-charges";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { vendor } from "@/lib/dray/server";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { mcleodOrderStops, stopAtScmYard } from "@/lib/inbound/checkin/yard-stop";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { isSavannahE2openBooking } from "@/lib/warehouse/outbound/e2open-customer";
import { dallasOrderBookingReferences } from "@/lib/warehouse/outbound/planning-info";

const key = (value: unknown) => String(value ?? "").trim().toUpperCase();
const missing = (error: string, status: number) => NextResponse.json({ error }, { status });
const maxMatches = 20;

export const GET = withStaffAccess(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const containerId = req.nextUrl.searchParams.get("containerId") ?? "";
  if (![id, containerId].every(value => /^[0-9a-f-]{36}$/i.test(value))) return missing("Choose a saved booking container.", 400);
  const db = staffDatabase();
  const [booking, row] = await Promise.all([
    db.from("cotton_outbound_bookings").select("terminal,site_code,customer,booking_number").eq("id", id).maybeSingle(),
    db.from("cotton_outbound_containers").select("container_number,booking_line_id").eq("booking_id", id).eq("id", containerId)
      .is("split_transfer_id", null).maybeSingle(),
  ]);
  if (booking.error || row.error) return missing("Could not load the booking container.", 503);
  if (!booking.data || !row.data) return missing("Booking container not found.", 404);
  const { terminal, site_code, customer, booking_number } = booking.data;
  const container = key(row.data.container_number);
  if (!/^[A-Z]{4}\d{7}$/.test(container)) return missing("Save a complete container number before searching.", 400);
  const site = CHECKIN_SITES.find(item => item.terminal === terminal && item.siteCode === site_code);
  const dallas = terminal === "DAL" ? bookingChargeCustomer(customer) : null;
  const savannah = isSavannahE2openBooking(terminal, customer);
  if (!site || !dallas && !savannah) return missing("McLeod lookup is available for configured Dallas dray customers and Savannah Louis Dreyfus bookings.", 422);

  const line = savannah && row.data.booking_line_id ? await db.from("cotton_outbound_booking_lines")
    .select("mark,shipping_order").eq("id", row.data.booking_line_id).eq("booking_id", id).maybeSingle() : null;
  if (line?.error) return missing("Could not verify the booking mark.", 503);
  if (savannah && (!line?.data?.mark || !line.data.shipping_order)) return missing("Save the mark and shipping order before searching.", 400);

  const { read } = vendor(true);
  try {
    const query = new URLSearchParams({ "orders.consignee_refno": container, recordLength: String(maxMatches) });
    if (dallas) query.set("orders.revenue_code_id", "DDRAY");
    const results = extractSearchOrders(await read(`/orders/search?${query}`));
    if (!results || results.length >= maxMatches) return missing("McLeod returned an incomplete search. Review this container in McLeod.", 409);
    const orderIds = [...new Set(results.map(row => String((row as { id?: unknown })?.id ?? "")))];
    if (orderIds.some(orderId => !/^[A-Za-z0-9_-]{1,60}$/.test(orderId))) throw new Error("Invalid order identifier.");
    const matches = [];
    for (const orderId of orderIds) {
      const order = await read(`/orders/${encodeURIComponent(orderId)}`);
      if (!order || String(order.id) !== orderId) throw new Error("McLeod returned an unexpected order.");
      if (key(order.consignee_refno) !== container || [order.status, order.__statusDescr].some(status =>
        /^(V|VOID|VOIDED|CANCELLED|CANCELED)$/.test(key(status)))) continue;
      if (dallas) {
        const references = dallasOrderBookingReferences(order);
        if (references.size !== 1 || !references.has(key(booking_number)) || key(order.revenue_code_id) !== "DDRAY" ||
          !dallas.ids.includes(key(order.customer_id)) || !mcleodOrderStops(order).some(stop =>
            key(stop.stop_type) === "PU" && stopAtScmYard(stop, site.siteName, site.terminal))) continue;
      } else if (!["ALLELOTN", "LDCACOTN"].includes(key(order.customer_id)) ||
        key(order.booking_no_sucm) !== key(booking_number) || key(order.blnum) !== key(line?.data?.mark) ||
        key(order.ordered_by) !== key(line?.data?.shipping_order)) continue;

      const movement = Array.isArray(order.movements) ? order.movements.find(item => String(item?.id) === String(order.curr_movement_id ?? "")) : undefined;
      matches.push({ ...bookingOrderCharges(order), carrierId: movement?.override_payee_id ?? movement?.carrier_id ?? null,
        carrierPay: movement?.override_pay_amt ?? null });
    }
    if (matches.length > 1) return missing("Multiple McLeod orders match this booking container. Review the matches in McLeod.", 409);
    return NextResponse.json({ order: matches[0] ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return missing("McLeod order lookup is unavailable.", 502);
  }
});
