import { readBookingSource, BOOKING_UPLOAD_BUCKET } from "@/lib/warehouse/outbound/booking-source";
import { staffDatabase } from "@/lib/auth/session";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";

import { planOutboundDrayLoads } from "@/lib/dray/outbound-load-plan";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { hash, vendor } from "@/lib/dray/server";

import { carrierPlanLines, type CarrierPlan } from "@/lib/warehouse/outbound/carrier-rates";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { dallasBookingFields, dallasImportPayload, matchesDallasImportDate, stagedDallasLocalTime } from "@/lib/dray/dallas-import-orders";
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
      if (input.action === "preview-details" || input.action === "apply-details" || input.action === "preview-carrier" || input.action === "apply-carrier" || input.action === "apply-extras")
        return await syncBookingDetails(input);
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
        p_loads: [first, ...remaining].map(load => dallasImportPayload(load, preview.bookingNumber, customer.code, details.erd!, details.cutoff!, {
          bookId, docCutoff: details.doc_cutoff, steamshipLine: details.steamship_line ?? null, boltSealsRequired: form.get("boltSealsRequired") === "true",
        })),
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
    const payload = {
      ...load.payload, order_type_id: "FSCD",
      ...Object.fromEntries(["cutoff_date", "doc_cutoff_date"].filter(field => load.payload[field])
        .map(field => [field, stagedDallasLocalTime(load.payload[field])])),
      stops: load.payload.stops.map((stop: { sched_arrive_early: string; sched_arrive_late: string }) => ({
        ...stop,
        sched_arrive_early: stagedDallasLocalTime(stop.sched_arrive_early),
        sched_arrive_late: stagedDallasLocalTime(stop.sched_arrive_late),
      })),
    };
    const { data: claim, error: claimError } = await db.from("dallas_dray_import_loads")
      .update(collision ? { state: "review" } : { state: "writing", payload }).eq("blnum", load.blnum).eq("state", "pending").select("blnum").maybeSingle();
    if (claimError) throw Error("Could not claim the next import load.");
    if (!claim) continue;
    load.state = "review";
    if (collision) continue;
    try {
      const created = await write("/orders/create", payload);
      const orderId = String(created?.id ?? "");
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw Error("No SCM order number returned.");
      load.order_id = orderId;
      const found = await read(`/orders/${orderId}`);
      const stops = found ? mcleodOrderStops(found) : [];
      if (String(found?.id) !== orderId || found.blnum !== load.blnum ||
          found.revenue_code_id !== "DDRAY" || found.order_type_id !== payload.order_type_id ||
          String(found.planning_comment ?? "").trim() !== load.payload.planning_comment || found.customer_id !== load.payload.customer_id ||
          found.booking_no_sucm !== load.payload.booking_no_sucm ||
          (load.payload.ssl_sucm && String(found.ssl_sucm ?? "").trim() !== load.payload.ssl_sucm) ||
          (["cutoff_date", "doc_cutoff_date"] as const).some(field =>
            payload[field] && !matchesDallasImportDate(found[field], payload[field])) ||
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


async function syncBookingDetails(input: {
  action: string; bookingId: string; orderId: string; token?: string; fields?: string[]; boltSealsRequired?: boolean;
}) {
  if (!/^[a-f0-9-]{36}$/i.test(input.bookingId) || !/^[A-Za-z0-9_-]{1,60}$/.test(input.orderId))
    throw Error("Choose a verified SCM order.");
  const apply = ["apply-details", "apply-carrier", "apply-extras"].includes(input.action);
  if (apply) requireWrites();
  const db = staffDatabase();
  const [booking, load] = await Promise.all([
    db.from("cotton_outbound_bookings").select("booking_number,scm_file_number,status,erd,cutoff,doc_cutoff,steamship_line")
      .eq("id", input.bookingId).eq("terminal", "DAL").maybeSingle(),
    db.from("dallas_dray_import_loads").select("blnum,payload,sequence_no").eq("booking_id", input.bookingId)
      .eq("order_id", input.orderId).eq("state", "verified").maybeSingle(),
  ]);
  const saved = booking.data;
  if (booking.error || load.error || saved?.status !== "draft" || !load.data || !saved.scm_file_number || !saved.erd || !saved.cutoff)
    throw Error("An active Dallas booking, sailing dates, and a verified linked order are required.");
  const { read, write } = vendor(!apply);
  const path = `/orders/${input.orderId}`;
  async function readLinkedOrder() {
    const order = await read(path);
    if (String(order?.id) !== input.orderId || order.revenue_code_id !== "DDRAY" ||
        order.customer_id !== load.data!.payload.customer_id ||
        String(order.blnum ?? "").trim().split(/\s+/)[0] !== load.data!.blnum ||
        (order.booking_no_sucm && String(order.booking_no_sucm).trim() !== saved!.booking_number) ||
        [order.status, order.__statusDescr].some(status => /^(V|VOID|VOIDED|CANCELED|CANCELLED)$/i.test(String(status ?? "").trim())))
      throw Error("McLeod order identity could not be verified.");
    return order;
  }
  const current = await readLinkedOrder();
  if (input.action.endsWith("-carrier") || input.action === "apply-extras") {
    const row = await db.from("cotton_outbound_containers").select("carrier_plan,updated_at")
      .eq("booking_id", input.bookingId).eq("sequence_no", load.data.sequence_no).is("split_transfer_id", null).maybeSingle();
    const plan = row.data?.carrier_plan as CarrierPlan | null | undefined;
    if (row.error || !plan) throw Error("Save a carrier assignment on this load first.");
    const carrier = plan.rate.carrier_id.trim().toUpperCase();
    const lines = carrierPlanLines(plan);
    const baseCents = lines.find(line => line.key === "base")?.payTotal;
    if (!/^[A-Z0-9_-]{1,30}$/.test(carrier) || baseCents == null || !Number.isSafeInteger(baseCents) || baseCents < 0)
      throw Error("The saved carrier or base pay is invalid.");
    const pay = baseCents / 100;
    const movementFor = (order: typeof current) => {
      const movements = Array.isArray(order.movements) ? order.movements : [];
      const movement = movements.length === 1 ? movements[0] : null;
      if (!movement || String(movement.id) !== String(order.curr_movement_id) ||
          !/^[A-Za-z0-9_-]{1,60}$/.test(String(movement.id)))
        throw Error("Could not verify a single current McLeod movement.");
      return movement;
    };
    const movement = movementFor(current);
    const currentPayee = String(movement.override_payee_id ?? "").trim();
    const currentPay = String(movement.override_pay_rate ?? "").trim() ? Number(movement.override_pay_rate) : null;
    const hasExpectedPay = (saved: typeof movement) =>
      String(saved.override_payee_id ?? "").trim() === carrier &&
      String(saved.override_type ?? "").trim() === "F" && Number(saved.override_units) === 1 &&
      [saved.override_pay_rate, saved.override_paye_rate, saved.override_pay_amt].every(value =>
        String(value ?? "").trim() !== "" && Math.round(Number(value) * 100) === baseCents);
    const assignedCarrier = String(movement.carrier_id || movement.vendor_id || "").trim().toUpperCase();
    const otherPayPath = `/movements/${encodeURIComponent(movement.id)}/otherPay`;
    const readExtras = async () => {
      const rows = await read(otherPayPath);
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.deduct_code_id !== "string" ||
          !String(row.amount ?? "").trim() || !Number.isFinite(Number(row.amount))))
        throw Error("McLeod Other Carrier Pay could not be verified.");
      return rows.map(row => ({ code: row.deduct_code_id.trim(), payee: String(row.payee_id ?? "").trim(),
        description: String(row.descr ?? ""), amount: Number(row.amount), id: String(row.id ?? "") }));
    };
    let otherPayIssue = "";
    const otherPay = await readExtras().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      const status = /^McLeod HTTP (\d{3}):/.exec(message)?.[1];
      otherPayIssue = status
        ? `McLeod Other Carrier Pay lookup failed (HTTP ${status}).`
        : message === "McLeod Other Carrier Pay could not be verified."
          ? "McLeod returned an unrecognized Other Carrier Pay response."
          : "McLeod Other Carrier Pay could not be reached or read.";
      console.warn("Dallas Other Carrier Pay lookup failed", { status: status ?? null, issue: otherPayIssue });
      return null;
    });
    const codes = { chassisDays: "001", stopoffs: "002", chassisSplits: "CS" };
    const proposedExtras = lines.flatMap(line => line.key === "base" || line.units <= 0 || line.payTotal <= 0 ? [] : [{
      code: codes[line.key], description: line.label, amount: line.payTotal / 100,
      units: line.units, rate: line.pay / 100,
    }]);
    const matchesExtra = (row: NonNullable<typeof otherPay>[number], line: typeof proposedExtras[number]) =>
      row.code === line.code && row.payee === carrier && Math.round(row.amount * 100) === Math.round(line.amount * 100);
    const missingExtras = proposedExtras.filter(line => !otherPay?.some(row => row.code === line.code));
    const conflict = proposedExtras.some(line => {
      const sameCode = otherPay?.filter(row => row.code === line.code) ?? [];
      return sameCode.length > 0 && (sameCode.length !== 1 || !matchesExtra(sameCode[0], line));
    });
    const blockers = [
      ...(current.status !== "A" || (movement.status && movement.status !== "A") ? ["McLeod order and movement must be available."] : []),
      ...(assignedCarrier && assignedCarrier !== carrier ? ["McLeod has a different dispatched carrier. Review the swap in McLeod."] : []),
      ...(currentPayee && currentPayee !== carrier && otherPay?.length !== 0 ? ["Review existing Other Carrier Pay before changing the payee."] : []),
    ];
    const changed = !hasExpectedPay(movement);
    const token = hash([input.bookingId, input.orderId, row.data?.updated_at, movement, current.status, carrier, pay, otherPay, proposedExtras]);
    const headers = { "Cache-Control": "private, no-store" };
    const extrasBlockers = [...blockers,
      ...(!otherPay ? [otherPayIssue] : []),
      ...(conflict ? ["An existing charge has the same code with different pay. Review it in McLeod."] : []),
      ...(currentPayee !== carrier ? ["Apply the carrier payee before sending extra pay."] : []),
    ];
    if (!apply) return NextResponse.json({ token, extrasBlockers, missingExtras, currentPayee, assignedCarrier, currentPay, carrier, pay,
      otherPay, proposedExtras, blockers, changed }, { headers });
    if (input.action === "apply-extras") {
      if (input.token !== token || extrasBlockers.length || !missingExtras.length)
        throw Error("Extra pay could not be applied. Preview the order again.");
      for (const line of missingExtras) {
        const fresh = await readExtras();
        if (fresh.some(row => row.code === line.code)) throw Error("Extra pay changed. Preview the order again.");
        await write(otherPayPath, { __type: "driver_extra_pay", company_id: "TMS", movement_id: String(movement.id),
          order_id: input.orderId, payee_id: carrier, deduct_code_id: line.code,
          descr: line.description, units: line.units, rate: line.rate, amount: line.amount });
        const verified = (await readExtras()).filter(row => row.code === line.code);
        if (verified.length !== 1 || !matchesExtra(verified[0], line)) return NextResponse.json({ verified: false }, { headers });
      }
      return NextResponse.json({ verified: true }, { headers });
    }
    if (input.token !== token || blockers.length || !changed)
      throw Error("Carrier or pay could not be applied. Preview the order again.");
    await write("/movement/update", {
      __type: "movement", company_id: "TMS", id: String(movement.id),
      override_payee_id: carrier, override_type: "F", override_units: 1,
      override_pay_amt: pay, override_pay_rate: pay, override_paye_rate: pay,
    });
    const updated = movementFor(await readLinkedOrder());
    if (String(updated.id) !== String(movement.id) || String(updated.override_payee_id ?? "").trim() !== carrier)
      return NextResponse.json({ verified: false }, { headers });
    await write(`/carrierDispatch/setPay/${encodeURIComponent(movement.id)}?method=F&units=1&rate=${pay}&carrierPay=${pay}`);
    const verified = movementFor(await readLinkedOrder());
    return NextResponse.json({ verified: String(verified.id) === String(movement.id) && hasExpectedPay(verified) }, { headers });
  }
  const expected = dallasBookingFields(saved.booking_number, saved.erd, saved.cutoff.replace(" ", "T"), {
    bookId: saved.scm_file_number, steamshipLine: saved.steamship_line, docCutoff: saved.doc_cutoff?.replace(" ", "T"),
    boltSealsRequired: input.boltSealsRequired === true,
  });
  const matches = (field: string, actual: unknown, value: string) =>
    field === "cutoff_date" || field === "doc_cutoff_date"
      ? matchesDallasImportDate(actual, value) : String(actual ?? "").trim() === value;
  const changes = Object.entries(expected).filter(([field, value]) => !matches(field, current[field], value))
    .map(([field, value]) => ({ field, before: String(current[field] ?? "").trim(), after: value }));
  const token = hash([input.bookingId, input.orderId, changes]);
  const headers = { "Cache-Control": "private, no-store" };
  if (!apply) return NextResponse.json({ changes, token }, { headers });
  if (input.token !== token) throw Error("Booking or McLeod values changed. Preview the order again.");
  const selected = changes.filter(change => input.fields?.includes(change.field));
  if (!selected.length) throw Error("Select at least one booking detail to apply.");
  await write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: input.orderId,
    ...Object.fromEntries(selected.map(change => [change.field, change.after])) });
  const verified = await readLinkedOrder();
  const differences = selected.filter(change => !matches(change.field, verified[change.field], change.after));
  return NextResponse.json({ verified: differences.length === 0, differences: differences.map(change => change.field) }, { headers });
}
