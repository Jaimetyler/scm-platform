import { readBookingSource, BOOKING_UPLOAD_BUCKET } from "@/lib/warehouse/outbound/booking-source";
import { staffDatabase } from "@/lib/auth/session";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";

import { planOutboundDrayLoads } from "@/lib/dray/outbound-load-plan";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { vendor } from "@/lib/dray/server";

import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { dallasImportPayload } from "@/lib/dray/dallas-import-orders";
import { mcleodOrderStops } from "@/lib/inbound/checkin/yard-stop";

export const runtime = "nodejs";
export const maxDuration = 120;

async function findOrders(prefix: string, requestSignal: AbortSignal) {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(75_000)]);
  const read = vendor(true).read;
  const found = new Map<string, { id: string; blnum: string }>();
  for (let offset = 0; offset < 600; offset += 25) {
    signal.throwIfAborted();
    const query = new URLSearchParams({ "orders.blnum": prefix + "*",
      "orders.revenue_code_id": "DDRAY", recordLength: "25", recordOffset: String(offset) });
    const page = extractSearchOrders(await read(`/orders/search?${query}`));
    if (!page || page.length > 25) throw Error("McLeod duplicate check returned an incomplete result.");
    for (const row of page as Record<string, unknown>[]) {
      const id = String(row?.id ?? "");
      const blnum = String(row?.blnum ?? "").trim().toUpperCase();
      if (!id || !blnum || found.has(id)) throw Error("McLeod duplicate check returned incomplete or repeated orders.");
      found.set(id, { id, blnum });
    }
    if (page.length < 25) return [...found.values()].filter(order =>
      order.blnum.startsWith(prefix) && /^\d+$/.test(order.blnum.slice(prefix.length)));
  }
  throw Error("Too many McLeod orders to complete the duplicate check.");
}

export const POST = withStaffAccess(async (request: NextRequest) => {
  try {
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = await request.json();
      if (input.action === "create-orders" || input.action === "import-status") {
        const id = String(input.bookingId ?? "");
        if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error("Choose a saved Dallas import.");
        return await createOrders(id, request.signal, input.action === "create-orders");
      }
      const bookingNumber = String(input.bookingNumber ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9_/-]{3,40}$/.test(bookingNumber)) throw Error("Enter a valid booking number.");
      normalizeBookingDetails(input.details ?? {});
      const loads = planOutboundDrayLoads(String(input.bookId ?? ""), input.containers, input.pickup, input.delivery);
      const prefix = loads[0].originalBlnum.slice(0, -1);
      const [bookings, orders] = await Promise.all([
        staffDatabase().from("cotton_outbound_bookings").select("id,site_code,site_name,status,planned_containers")
          .eq("terminal", "DAL").eq("booking_number", bookingNumber),
        findOrders(prefix, request.signal),
      ]);
      if (bookings.error) throw Error("Could not check platform bookings.");
      const existing = bookings.data.length === 1 ? bookings.data[0] : null;
      const restoreId = existing?.status === "cancelled" && existing.site_code === loads[0].pickup &&
        existing.planned_containers === loads.length ? existing.id : null;
      return NextResponse.json({ restoreId, bookings: bookings.data.map(row => `${row.site_name} (${row.status})`), orders },
        { headers: { "Cache-Control": "private, no-store" } });
    }
    const form = await request.formData();
    const source = await readBookingSource(form, { owner: staffProfile(request)?.user_id ?? "", terminal: "DAL",
      secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", download: path => staffDatabase().storage.from(BOOKING_UPLOAD_BUCKET).download(path) }, "booking");
    const preview = previewDallasBungeDrays(source.bytes);
    if (form.get("action") === "import") {
      requireWrites();
      const bookId = String(form.get("bookId") ?? "").trim().toUpperCase();
      const [first, ...remaining] = planOutboundDrayLoads(bookId, preview.containers, preview.pickupLocation, preview.deliveryLocation);
      const details = normalizeBookingDetails({
        erd: form.get("erd"), cutoff: form.get("cutoff"), docCutoff: form.get("docCutoff"),
        vessel: form.get("vessel"), steamshipLine: form.get("steamshipLine"),
        scmFileNumber: bookId, returnLocation: preview.deliveryLocation,
      });
      const customer = bookingChargeCustomer(preview.customer);
      const site = CHECKIN_SITES.find(site => site.terminal === "DAL" && site.siteCode === first.pickup && site.materials.includes("cotton"));
      if (!customer || !site || preview.lines.some(line => !Number.isSafeInteger(line.bales) || line.bales < 1))
        throw Error("Resolve the Dallas warehouse, customer, and mark bale counts before importing.");
      if (!details.erd || !details.cutoff || details.erd > details.cutoff.slice(0, 10))
        throw Error("Enter an ERD and cutoff on or after the ERD.");
      const orders = await findOrders(bookId + "-", request.signal);
      if (orders.length) throw Error("McLeod already has numbered orders for this Book ID. Review the duplicate check.");
      const { data, error } = await staffDatabase().rpc("start_dallas_dray_import", {
        p_site_code: site.siteCode, p_site_name: site.siteName, p_customer: preview.customer,
        p_booking_number: preview.bookingNumber, p_customer_reference: preview.customerReference,
        p_source_filename: source.name.slice(0, 200),
        p_lines: preview.lines.map(line => ({ ...line, containerNumber: null })),
        p_details: { ...details, source_format: preview.sourceFormat, restore_booking_id: form.get("restoreBookingId") },
        p_loads: [first, ...remaining].map(load => dallasImportPayload(load, preview.bookingNumber, customer.code, details.erd!, details.cutoff!)),
      });
      if (error) throw Error(error.code === "23505" ? "This booking or Book ID already exists, or the cancelled booking has saved load details and cannot be restored for import." : "Could not save the Dallas import.");
      return NextResponse.json({ ok: true, bookingId: data, siteCode: site.siteCode });
    }
    return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Booking could not be read.";
    return NextResponse.json({ ok: false, error: message.startsWith("McLeod HTTP") ? "McLeod duplicate check is unavailable." : message }, { status: 400 });
  }
});

function requireWrites() {
  if (process.env.DRAY_IMPORT_WRITES_ENABLED !== "true" || process.env.MCLEOD_SYNC_ENABLED !== "true")
    throw Error("McLeod dray creation is disabled in this environment.");
}

async function createOrders(bookingId: string, signal: AbortSignal, apply: boolean) {
  if (apply) requireWrites();
  const db = staffDatabase();
  const { data: booking, error: bookingError } = await db.from("cotton_outbound_bookings")
    .select("status").eq("id", bookingId).eq("terminal", "DAL").maybeSingle();
  if (bookingError || booking?.status !== "draft") throw Error("The Dallas booking must be active to create orders.");
  const { data: loads, error } = await db.from("dallas_dray_import_loads")
    .select("blnum,state,order_id,payload").eq("booking_id", bookingId).order("sequence_no");
  if (error || !loads) throw Error("Saved Dallas import loads could not be found.");
  const { read, write } = vendor();
  for (const load of apply ? loads.filter(load => load.state === "pending").slice(0, 1) : []) {
    signal.throwIfAborted();
    const duplicates = await findOrders(load.blnum.slice(0, load.blnum.lastIndexOf("-") + 1), signal);
    const collision = duplicates.some(order => order.blnum === load.blnum);
    const { data: claim, error: claimError } = await db.from("dallas_dray_import_loads")
      .update({ state: collision ? "review" : "writing" }).eq("blnum", load.blnum).eq("state", "pending").select("blnum").maybeSingle();
    if (claimError) throw Error("Could not claim the next import load.");
    if (!claim) continue;
    load.state = "review";
    if (collision) continue;
    try {
      const created = await write("/orders/create", load.payload);
      const orderId = String(created?.id ?? "");
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw Error("No SCM order number returned.");
      load.order_id = orderId;
      const found = await read(`/orders/${orderId}`);
      const stops = found ? mcleodOrderStops(found) : [];
      if (String(found?.id) !== orderId || found.blnum !== load.blnum ||
          found.revenue_code_id !== "DDRAY" || found.customer_id !== load.payload.customer_id ||
          found.booking_no_sucm !== load.payload.booking_no_sucm ||
          !load.payload.stops.every((stop: { stop_type: string; location_id: string }) =>
            stops.some(saved => saved.stop_type === stop.stop_type && saved.location_id === stop.location_id)))
        throw Error("Created order did not verify.");
      load.state = "verified";
    } catch {
      load.state = "review";
    }
    const { error: saveError } = await db.from("dallas_dray_import_loads")
      .update({ state: load.state, order_id: load.order_id }).eq("blnum", load.blnum).eq("state", "writing");
    if (saveError) throw Error("An order may have been created. Review its BLNUM before retrying.");
  }
  return NextResponse.json({ loads: loads.map(({ blnum, state, order_id }) => ({ blnum, state, orderId: order_id })) },
    { headers: { "Cache-Control": "private, no-store" } });
}
