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
import { dallasFuelCode, planDallasFuelCorrection } from "@/lib/dray/dallas-fuel";
import { lockDallasBilling, rememberDallasCharge } from "@/lib/dray/dallas-billing-receipt";
import { planDallasCustomerExtras, readDallasCustomerCharges, type CustomerCharge } from "@/lib/dray/dallas-customer-extras";
import { dallasExtraPayDate, dallasExtraPayReference, dallasExtraPayLines, readDallasExtraPay } from "@/lib/dray/dallas-extra-pay";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { readBookingCustomerRate } from "@/lib/dray/booking-customer-rate";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { dallasBookingFields, dallasImportPayload, withRequiredCottonBoltSeals, matchesDallasImportDate, stagedDallasLocalTime } from "@/lib/dray/dallas-import-orders";
import { mcleodOrderStops } from "@/lib/inbound/checkin/yard-stop";
import { currentDallasMovement, readLinkedDallasOrder } from "@/lib/dray/dallas-linked-order";

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
      if (["preview-details", "apply-details", "preview-carrier", "apply-carrier", "preview-load", "apply-load"].includes(input.action))
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
          bookId, docCutoff: details.doc_cutoff, steamshipLine: details.steamship_line ?? null,
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
      ...load.payload, order_type_id: dallasFuelCode,
      planning_comment: withRequiredCottonBoltSeals(String(load.payload.planning_comment ?? "")),
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
          String(found.planning_comment ?? "").trim() !== payload.planning_comment || found.customer_id !== load.payload.customer_id ||
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
  action: string; bookingId: string; orderId: string; token?: string; fields?: string[];
}) {
  if (!/^[a-f0-9-]{36}$/i.test(input.bookingId) || !/^[A-Za-z0-9_-]{1,60}$/.test(input.orderId))
    throw Error("Choose a verified SCM order.");
  const apply = ["apply-details", "apply-carrier", "apply-load"].includes(input.action);
  const unified = input.action.endsWith("-load");
  if (apply) requireWrites();
  const db = staffDatabase();
  const [booking, load] = await Promise.all([
    db.from("cotton_outbound_bookings").select("booking_number,scm_file_number,status,erd,cutoff,doc_cutoff,steamship_line,terminal,site_code,customer,return_location,return_location_code")
      .eq("id", input.bookingId).eq("terminal", "DAL").maybeSingle(),
    db.from("dallas_dray_import_loads").select("blnum,payload,sequence_no").eq("booking_id", input.bookingId)
      .eq("order_id", input.orderId).eq("state", "verified").maybeSingle(),
  ]);
  const saved = booking.data;
  if (booking.error || load.error || saved?.status !== "draft" || !load.data || !saved.scm_file_number || !saved.erd || !saved.cutoff)
    throw Error("An active Dallas booking, sailing dates, and a verified linked order are required.");
  const slot = await db.from("cotton_outbound_containers").select("container_number,booking_line_id,carrier_plan,updated_at")
    .eq("booking_id", input.bookingId).eq("sequence_no", load.data.sequence_no).is("split_transfer_id", null).maybeSingle();
  if (slot.error || !slot.data) throw Error("The linked booking load could not be found.");
  const { read, write } = vendor(!apply);
  const readLinkedOrder = () => readLinkedDallasOrder(read, input.orderId, saved.booking_number, load.data!);
  const current = await readLinkedOrder();
  const headers = { "Cache-Control": "private, no-store" };
  async function prepareDetails() {
    const markRow = slot.data!.booking_line_id ? await db.from("cotton_outbound_booking_lines")
      .select("mark,line_status").eq("booking_id", input.bookingId).eq("id", slot.data!.booking_line_id).maybeSingle() : null;
    if (markRow && (markRow.error || !markRow.data)) throw Error("Could not verify the saved mark.");
    const mark = markRow?.data?.line_status === "active" ? String(markRow.data.mark ?? "").trim() : "";
    const container = String(slot.data!.container_number ?? "").trim().toUpperCase();
    const bookingFields = dallasBookingFields(saved!.booking_number, saved!.erd!, saved!.cutoff!.replace(" ", "T"), {
      bookId: saved!.scm_file_number!, steamshipLine: saved!.steamship_line, docCutoff: saved!.doc_cutoff?.replace(" ", "T"),
    });
    const currentComment = String(current.planning_comment ?? "").trim();
    const requiredComment = withRequiredCottonBoltSeals(currentComment);
    const expected = { ...bookingFields,
      ...(currentComment && (unified || currentComment !== requiredComment) ? { planning_comment: requiredComment } : {}), ...(mark ? { blnum: mark } : {}),
      ...(/^[A-Z]{4}\d{7}$/.test(container) ? { consignee_refno: container } : {}) };
    const matches = (field: string, actual: unknown, value: string) =>
      field === "cutoff_date" || field === "doc_cutoff_date"
        ? matchesDallasImportDate(actual, value) : String(actual ?? "").trim() === value;
    const changes = Object.entries(expected).filter(([field, value]) => !matches(field, current[field], value))
      .map(([field, value]) => ({ field, before: String(current[field] ?? "").trim(), after: value,
        required: field === "planning_comment" && currentComment !== requiredComment }));
    async function sendDetails(selected: typeof changes) {
      if (selected.some(change => change.field === "blnum") &&
          String(current.booking_no_sucm ?? "").trim() !== saved!.booking_number &&
          !selected.some(change => change.field === "booking_no_sucm"))
        throw Error("Select the booking number together with the mark to preserve the McLeod link.");
      const fresh = await readLinkedOrder();
      if (selected.some(change => String(fresh[change.field] ?? "").trim() !== change.before))
        throw Error("McLeod booking details changed during sync. Preview again.");
      await write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: input.orderId,
        ...Object.fromEntries(selected.map(change => [change.field, change.after])) });
      const verified = await readLinkedOrder();
      const differences = selected.filter(change => !matches(change.field, verified[change.field], change.after));
      return differences.map(change => change.field);
    }
    return { changes, sendDetails };
  }
  const details = unified || input.action.endsWith("-details") ? await prepareDetails() : null;
  const detailBlockers = unified && current.status !== "A" && details?.changes.length
    ? ["McLeod must show the order as available to sync booking details."] : [];
  const detailChanges = unified ? details!.changes : [];
  const canSendDetails = detailChanges.length > 0 && !detailBlockers.length;
  const plan = slot.data.carrier_plan as CarrierPlan | null | undefined;

  async function sendUnifiedDetails() {
    const differences = await details!.sendDetails(detailChanges);
    if (differences.length) throw Error(`McLeod did not verify ${differences.join(", ")}. Preview again before applying.`);
  }

  async function verifyLoadVersion() {
    const { data: active, error } = await db.from("cotton_outbound_containers").select("updated_at")
      .eq("booking_id", input.bookingId).eq("sequence_no", load.data!.sequence_no).is("split_transfer_id", null).maybeSingle();
    if (error || active?.updated_at !== slot.data!.updated_at)
      throw Error("The platform load changed during sync. Preview the differences again.");
  }

  function lockLoad() {
    return lockDallasBilling(db, input.bookingId, { ...load.data!, order_id: input.orderId });
  }

  if (unified && !plan) {
    const token = hash([input.bookingId, input.orderId, slot.data.updated_at, current.status, detailChanges]);
    if (!apply) return NextResponse.json({ token, detailChanges, detailBlockers, canSendDetails,
      canSendPay: false, canSendExtras: false, canSendBilling: false, fuelChanges: [],
      blockers: [], extrasBlockers: [], billingBlockers: [], carrier: null }, { headers });
    if (input.token !== token) throw Error("Platform or McLeod values changed. Preview the differences again.");
    if (!canSendDetails) return NextResponse.json({ applied: [], issues: detailBlockers }, { headers });
    const history = await lockLoad();
    try {
      await verifyLoadVersion();
      if (history.receipt?.restoringFromTotal !== undefined)
        throw Error("Customer charge restoration is pending. Finish unassigning this load first.");
      await sendUnifiedDetails();
      return NextResponse.json({ applied: ["Booking details"], issues: [] }, { headers });
    } finally {
      await history.release().catch(error => console.error("Could not release Dallas billing lock", error.message));
    }
  }

  if (unified || input.action.endsWith("-carrier")) {
    if (!plan) throw Error("Save a carrier assignment on this load first.");
    const carrier = plan.rate.carrier_id.trim().toUpperCase();
    const lines = carrierPlanLines(plan);
    const baseCents = lines.find(line => line.key === "base")?.payTotal;
    if (!/^[A-Z0-9_-]{1,30}$/.test(carrier) || baseCents == null || !Number.isSafeInteger(baseCents) || baseCents < 0)
      throw Error("The saved carrier or base pay is invalid.");
    const pay = baseCents / 100;
    const movementFor = currentDallasMovement;
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
    const readExtras = () => readDallasExtraPay(read, movement.id);
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
    const proposedExtras = dallasExtraPayLines(plan);
    const matchesExtra = (row: NonNullable<typeof otherPay>[number], line: typeof proposedExtras[number]) =>
      row.code === line.code && row.payee === carrier && Math.round(row.amount * 100) === Math.round(line.amount * 100);
    const extraIssues: string[] = [];
    const extraChanges = proposedExtras.flatMap(line => {
      if (!otherPay) return [];
      const sameCode = otherPay.filter(row => row.code === line.code);
      if (!sameCode.length) return [{ ...line, previous: null as NonNullable<typeof otherPay>[number] | null }];
      const [previous] = sameCode;
      if (sameCode.length === 1 && matchesExtra(previous, line)) return [];
      const sameDescription = previous.description === line.description ||
        (line.code === "001" && previous.description === "Extra chassis days");
      if (sameCode.length === 1 && previous.payee === carrier && previous.orderId === input.orderId &&
          previous.movementId === String(movement.id) && /^[A-Za-z0-9_-]{1,32}$/.test(previous.id) &&
          otherPay.filter(row => row.id === previous.id).length === 1 &&
          (previous.reference === dallasExtraPayReference || (!previous.reference && sameDescription)))
        return [{ ...line, previous }];
      extraIssues.push(`Other Carrier Pay ${line.code} differs and could not be uniquely linked to this load and carrier.`);
      return [];
    });
    const blockers = [
      ...(current.status !== "A" || (movement.status && movement.status !== "A") ? ["McLeod order and movement must be available."] : []),
      ...(assignedCarrier && assignedCarrier !== carrier ? ["McLeod has a different dispatched carrier. Review the swap in McLeod."] : []),
      ...(currentPayee && currentPayee !== carrier && otherPay?.length !== 0 ? ["Review existing Other Carrier Pay before changing the payee."] : []),
    ];
    const changed = !hasExpectedPay(movement);
    const customerRate = await readBookingCustomerRate(db, saved).catch(() => null);
    const msc = /^(?:MSC\b|MEDITERRANEAN SHIPPING COMPANY\b)/i.test(String(saved.steamship_line ?? "").trim());
    const rawBilling = current.otherCharges ?? current.other_charges ?? current.otherCharge;
    const fuelCorrection = planDallasFuelCorrection(current, rawBilling);
    const fuelChanges = [
      ...(fuelCorrection.types ? ["Order type FSC → FSCD"] : []),
      ...(fuelCorrection.fuel ? ["Customer fuel charge FSC → FSCD"] : []),
    ];
    const currentTotal = Number(current.total_charge);
    const baseRate = Number(current.rate);
    const rateUnits = Number(current.rate_units);
    const validFlatRate = current.rate_type === "F" && Boolean(String(current.rate ?? "").trim()) &&
      Number.isFinite(baseRate) && Number.isFinite(rateUnits) && rateUnits > 0;
    const customerBaseCents = validFlatRate ? Math.round(baseRate * rateUnits * 100) : NaN;
    const billed = readDallasCustomerCharges(rawBilling, customerBaseCents, Math.round(currentTotal * 100));
    const { changes: billingChanges, blockers: billingLineIssues } = planDallasCustomerExtras(plan.quantities, customerRate, billed, msc);
    const matchesBill = (row: Pick<CustomerCharge, "code" | "amount" | "units" | "rate">, line: typeof billingChanges[number]) =>
      row.code === line.code && row.amount !== null &&
      Math.round(row.amount * 100) === Math.round(line.amount * 100) && row.units === line.units && row.rate === line.rate;
    const billingBlockers = billingChanges.length ? [
      ...(current.status !== "A" ? ["McLeod order must be available to add customer charges."] : []),
      ...(!validFlatRate ? ["McLeod has no verified flat base rate. Apply the customer’s standard rate before syncing extras."] : []),
      ...(current.total_charge == null || !String(current.total_charge).trim() || !Number.isFinite(currentTotal)
        ? ["McLeod customer bill total could not be verified."] : []),
    ] : [];
    const movementState = [movement.id, movement.status, assignedCarrier, currentPayee, movement.override_type,
      movement.override_units, movement.override_pay_rate, movement.override_paye_rate, movement.override_pay_amt];
    const token = hash([input.bookingId, input.orderId, slot.data.updated_at, movementState, current.status, carrier, pay,
      otherPay, proposedExtras, current.total_charge, billed, billingChanges, billingLineIssues, baseRate, rateUnits, current.order_type_id, fuelCorrection, detailChanges]);
    const extrasBlockers = [...blockers,
      ...(proposedExtras.length && !otherPay ? [otherPayIssue] : []),
    ];
    const canSendPay = changed && blockers.length === 0;
    const canSendExtras = extraChanges.length > 0 && extrasBlockers.length === 0 && (currentPayee === carrier || canSendPay);
    const canSendBilling = billingChanges.length > 0 && billingBlockers.length === 0;
    const review = { token, detailChanges, canSendDetails, detailBlockers, billingBlockers: [...billingLineIssues, ...billingBlockers, ...fuelCorrection.issues], fuelChanges, billed, proposedBilling: billingChanges, extrasBlockers: [...extrasBlockers, ...extraIssues], currentPayee, assignedCarrier, currentPay, carrier, pay,
      otherPay, proposedExtras, blockers, changed, canSendPay, canSendExtras, canSendBilling };
    if (!apply) return NextResponse.json(review, { headers });
    if (input.token !== token) throw Error("Platform or McLeod values changed. Preview the differences again.");

    async function writeBilling(history: Awaited<ReturnType<typeof lockDallasBilling>>) {
      const fresh = await readLinkedOrder();
      const billingSnapshot = (order: typeof current) => [order.status, order.rate_type, order.rate, order.rate_units,
        order.total_charge, order.otherCharges ?? order.other_charges ?? order.otherCharge];
      if (hash(billingSnapshot(current)) !== hash(billingSnapshot(fresh)))
        throw Error("Customer billing changed during sync. Preview the differences again.");
      if (!validFlatRate || !billed || !Array.isArray(rawBilling))
        throw Error("McLeod did not return a verifiable flat rate and charge list.");
      const unresolved = billed.filter(row => row.amount === null || row.inclusion === null);
      if (unresolved.length)
        throw Error(`McLeod returned unresolved billing fields for ${unresolved.map(row => `${row.code} (amount ${row.amount ?? "blank"}, freight ${row.inclusion ?? "unverified"})`).join(", ")}.`);
      const existingCents = customerBaseCents + billed.reduce((sum, row) =>
        sum + (row.inclusion === "N" ? Math.round(row.amount! * 100) : 0), 0);
      const totalCents = existingCents + billingChanges.reduce((sum, line) => sum + Math.round(line.amount * 100) - Math.round((line.previous?.amount ?? 0) * 100), 0);
      if (![existingCents, totalCents].includes(Math.round(currentTotal * 100)))
        throw Error("The current bill total does not reconcile with the flat rate and charge lines. Review billing in McLeod.");
      let expectedCents = existingCents;
      let billingState = fresh;
      for (const line of billingChanges) {
        const before = await readLinkedOrder();
        if (hash(billingSnapshot(billingState)) !== hash(billingSnapshot(before)))
          throw Error("Customer billing changed during sync. Preview the differences again.");
        const original = line.previous && rawBilling.find(row => String(row.id ?? "") === line.previous?.id);
        await history.record(rememberDallasCharge(history.receipt, line.code, line.previous, line));
        let writeFailure: unknown;
        try {
          await write(line.previous ? "/other_charge/update" : "/other_charge/create", {
            ...(original || {}),
            __type: "other_charge", company_id: "TMS", order_id: input.orderId,
            charge_id: line.code, descr: line.description,
            units: line.units, rate: line.rate, amount: line.amount, incl_in_freight: "N",
            ...(line.previous ? {} : { bill_type: "F", calc_method: "F" }),
          });
        } catch (error) {
          writeFailure = error;
        }
        const updated = await readLinkedOrder();
        expectedCents += Math.round(line.amount * 100) - Math.round((line.previous?.amount ?? 0) * 100);
        const charges = readDallasCustomerCharges(updated.otherCharges ?? updated.other_charges ?? updated.otherCharge,
          customerBaseCents, expectedCents);
        const matches = charges?.filter(row => row.code === line.code) ?? [];
        if (matches.length !== 1 || !matchesBill(matches[0], line) || (line.previous && matches[0].id !== line.previous.id))
          throw new Error(`${line.code} did not verify after the direct charge-row write${writeFailure instanceof Error ? `: ${writeFailure.message}` : "."}`);
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(matches[0].id))
          throw Error(`McLeod did not return the ${line.code} charge ID for unassignment.`);
        const receipt = history.receipt!;
        await history.record({ charges: receipt.charges.map(entry => entry.code === line.code ? { ...entry, chargeId: matches[0].id } : entry) });
        const unchangedRows = (order: typeof current) => (order.otherCharges ?? order.other_charges ?? order.otherCharge)
          .filter((row: Record<string, unknown>) => String(row.charge_id ?? "").trim().toUpperCase() !== line.code);
        const expectedOtherRows = unchangedRows(updated);
        if (hash(expectedOtherRows) !== hash(unchangedRows(before)) ||
            updated.status !== current.status || Number(updated.rate) !== baseRate ||
            Number(updated.rate_units) !== rateUnits || updated.rate_type !== current.rate_type)
          throw Error("The order or another customer charge changed during sync. Review the bill before retrying.");
        if (Math.round(Number(updated.total_charge) * 100) !== expectedCents)
          await write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: input.orderId, total_charge: expectedCents / 100 });
        billingState = await readLinkedOrder();
        if (Math.round(Number(billingState.total_charge) * 100) !== expectedCents)
          throw Error(`${line.code} posted, but McLeod did not verify the updated order total.`);
      }
      const after = await readLinkedOrder();
      const actual = readDallasCustomerCharges(after.otherCharges ?? after.other_charges ?? after.otherCharge,
        customerBaseCents, Math.round(Number(after.total_charge) * 100));
      const differences: string[] = [];
      if (after.total_charge == null || !String(after.total_charge).trim() ||
          Math.round(Number(after.total_charge) * 100) !== totalCents)
        differences.push(`Bill total expected ${(totalCents / 100).toFixed(2)}, read back ${after.total_charge ?? "unavailable"}`);
      if (actual && billed.some(existing => !billingChanges.some(line => line.code === existing.code) && !actual.some(row =>
        row.code === existing.code && (!existing.id || row.id === existing.id) && row.amount === existing.amount)))
        differences.push("An existing McLeod charge changed during the update");
      if (!actual) differences.push("McLeod did not return customer charge lines");
      else for (const line of billingChanges) {
        const rows = actual.filter(row => row.code === line.code);
        if (rows.length !== 1) {
          differences.push(`${line.code}: expected one line, read back ${rows.length}`);
          continue;
        }
        const [row] = rows;
        if (!matchesBill(row, line))
          differences.push(`${line.code}: expected ${line.units} × ${line.rate} = ${line.amount}, read back ${row.units ?? "blank"} × ${row.rate ?? "blank"} = ${row.amount ?? "blank"}`);
      }
      if (differences.length) throw Error(differences.join(". "));
    }
    async function sendFuel() {
      const before = await readLinkedOrder();
      const orderCharges = (order: typeof current) => order.otherCharges ?? order.other_charges ?? order.otherCharge;
      if (hash(planDallasFuelCorrection(before, orderCharges(before))) !== hash(fuelCorrection))
        throw Error("Dallas fuel changed during sync. Preview the differences again.");
      const total = Number(before.total_charge);
      if (!String(before.total_charge ?? "").trim() || !Number.isFinite(total))
        throw Error("McLeod did not return a verifiable bill total for the fuel correction.");
      let latest = before;
      if (fuelCorrection.fuel) {
        const fuel = fuelCorrection.fuel;
        await write("/other_charge/update", { ...fuel, __type: "other_charge", company_id: "TMS",
          order_id: input.orderId, charge_id: dallasFuelCode });
        latest = await readLinkedOrder();
        const rows = orderCharges(latest);
        const saved = Array.isArray(rows) ? rows.find(row => String(row.id ?? "") === String(fuel.id)) : null;
        if (!saved || saved.charge_id !== dallasFuelCode || ["amount", "rate", "units", "incl_in_freight"].some(field =>
            String(saved[field] ?? "") !== String(fuel[field] ?? "")) || Number(latest.total_charge) !== total)
          throw Error("McLeod did not verify the FSCD charge with the original billing values.");
      }
      if (fuelCorrection.types) {
        await write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: input.orderId, order_type_id: dallasFuelCode });
        const after = await readLinkedOrder();
        if (after.order_type_id !== dallasFuelCode || Number(after.total_charge) !== total ||
            hash(orderCharges(after)) !== hash(orderCharges(latest)))
          throw Error("McLeod did not verify the FSCD order type with the same charges.");
      }
    }

    async function sendExtras() {
      const transactionDate = dallasExtraPayDate(new Date());
      for (const line of extraChanges) {
        const fresh = (await readExtras()).filter(row => row.code === line.code);
        if (hash(fresh) !== hash(line.previous ? [line.previous] : []))
          throw Error("Extra pay changed. Preview the order again.");
        const date = line.previous?.transactionDate || transactionDate;
        await write(line.previous ? "/driver_extra_pay/update" : otherPayPath, {
          ...(line.previous ? { id: line.previous.id } : {}),
          __type: "driver_extra_pay", company_id: "TMS", movement_id: String(movement.id),
          order_id: input.orderId, payee_id: carrier, deduct_code_id: line.code,
          transaction_date: date, reference_no: line.previous?.reference || dallasExtraPayReference,
          descr: line.description, units: line.units, rate: line.rate, amount: line.amount,
        });
        const verified = (await readExtras()).filter(row => row.code === line.code);
        if (verified.length !== 1 || !matchesExtra(verified[0], line) ||
            (line.previous && verified[0].id !== line.previous.id))
          throw Error(`McLeod did not verify extra pay code ${line.code}.`);
        if (verified[0].transactionDate.slice(0, 8) !== date.slice(0, 8))
          throw Error(`McLeod returned a different transaction date for extra pay code ${line.code}.`);
      }
    }

    async function sendBasePay() {
      await write("/movement/update", {
        __type: "movement", company_id: "TMS", id: String(movement.id),
        override_payee_id: carrier, override_type: "F", override_units: 1,
        override_pay_amt: pay, override_pay_rate: pay, override_paye_rate: pay,
      });
      const updated = movementFor(await readLinkedOrder());
      if (String(updated.id) !== String(movement.id) || String(updated.override_payee_id ?? "").trim() !== carrier)
        throw Error("McLeod did not verify the carrier payee.");
      await write(`/carrierDispatch/setPay/${encodeURIComponent(movement.id)}?method=F&units=1&rate=${pay}&carrierPay=${pay}`);
      const verified = movementFor(await readLinkedOrder());
      if (String(verified.id) !== String(movement.id) || !hasExpectedPay(verified))
        throw Error("McLeod did not verify the base carrier pay.");
    }

    const applied: string[] = [];
    const issues: string[] = [];
    async function send(label: string, action: () => Promise<void>) {
      try {
        await action();
        applied.push(label);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The update could not be verified.";
        issues.push(`${label}: ${reason}`);
        return false;
      }
    }
    const history = await lockLoad();
    try {
      if (history.receipt?.restoringFromTotal !== undefined)
        throw Error("Customer charge restoration is pending. Finish unassigning this load first.");
      await verifyLoadVersion();
      if (canSendDetails) await send("Booking details", sendUnifiedDetails);
      else issues.push(...detailBlockers);
      let payReady = !changed;
      if (canSendPay) payReady = await send("Carrier payee and base pay", sendBasePay);
      else if (changed) issues.push(...blockers);
      if (canSendExtras && payReady) await send("Other Carrier Pay", sendExtras);
      else if (extraChanges.length || (proposedExtras.length && !otherPay))
        issues.push(...(extrasBlockers.length ? extrasBlockers : ["Other Carrier Pay needs a verified carrier payee and base pay."]));
      if (canSendBilling) await send("Customer charges", () => writeBilling(history));
      else issues.push(...billingBlockers);
      if (fuelChanges.length) await send("Dallas fuel code FSCD", sendFuel);
      issues.push(...billingLineIssues, ...extraIssues, ...fuelCorrection.issues);
      return NextResponse.json({ applied, issues: [...new Set(issues)] }, { headers });
    } finally {
      await history.release().catch(error => console.error("Could not release Dallas billing lock", error.message));
    }
  }
  const { changes, sendDetails } = details!;
  const token = hash([input.bookingId, input.orderId, changes]);
  if (!apply) return NextResponse.json({ changes, token }, { headers });
  if (input.token !== token) throw Error("Booking or McLeod values changed. Preview the order again.");
  const selected = changes.filter(change => input.fields?.includes(change.field) || change.required);
  if (!selected.length) throw Error("Select at least one booking detail to apply.");
  const differences = await sendDetails(selected);
  return NextResponse.json({ verified: differences.length === 0, differences }, { headers });
}
