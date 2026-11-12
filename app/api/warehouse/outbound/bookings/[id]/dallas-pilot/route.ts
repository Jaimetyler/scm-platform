import { NextRequest, NextResponse } from "next/server";
import { staffActor, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { bookingChargeCustomer } from "@/lib/dray/booking-customers";
import { hash, vendor } from "@/lib/dray/server";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { createDallasPilotPayload, matchesDallasPilot, reviewDallasPilotOrder, type DallasPilotPlan } from "@/lib/warehouse/outbound/dallas-order-pilot";
import { dallasOrderBookingReferences } from "@/lib/warehouse/outbound/planning-info";
import { bookingReturnLocation } from "@/lib/warehouse/outbound/return-location";

export const maxDuration = 120;
const key = (value: unknown) => String(value ?? "").trim().toUpperCase();
const orderIdPattern = /^[A-Za-z0-9_-]{1,60}$/;
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 409) => NextResponse.json({ error }, { status, headers });
const writable = () => process.env.DALLAS_OUTBOUND_PILOT_WRITES_ENABLED === "true" &&
  process.env.DRAY_IMPORT_WRITES_ENABLED === "true" && process.env.MCLEOD_SYNC_ENABLED === "true";

async function readOrder(read: ReturnType<typeof vendor>["read"], id: string) {
  const order = await read(`/orders/${encodeURIComponent(id)}`);
  if (!order || String(order.id) !== id) throw Error("McLeod returned an unexpected SCM order number.");
  return order;
}

async function findOrder(read: ReturnType<typeof vendor>["read"], plan: DallasPilotPlan) {
  const query = new URLSearchParams({ "orders.consignee_refno": plan.container, "orders.revenue_code_id": "DDRAY", recordLength: "20" });
  const result = extractSearchOrders(await read(`/orders/search?${query}`));
  if (!result || result.length >= 20) throw Error("McLeod returned an incomplete container search.");
  const ids = [...new Set(result.map(row => String((row as { id?: unknown })?.id ?? "")))];
  if (ids.some(id => !orderIdPattern.test(id))) throw Error("McLeod returned an invalid SCM order number.");
  const candidates = await Promise.all(ids.map(id => readOrder(read, id)));
  const plausible = candidates.filter(order => {
    if (key(order.consignee_refno) !== plan.container ||
      [order.status, order.__statusDescr].some(status => /^(V|VOID|VOIDED|CANCELLED|CANCELED)$/.test(key(status)))) return false;
    const refs = dallasOrderBookingReferences(order);
    return refs.size === 0 || refs.has(plan.booking);
  });
  if (plausible.length > 1 || plausible.some(order => !matchesDallasPilot(order, plan))) {
    throw Error("An order may already exist for this booking container. Review the matches in McLeod.");
  }
  return plausible[0] ?? null;
}

async function handler(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const containerId = String(body?.containerId ?? "");
  if (!body || ![id, containerId].every(value => /^[0-9a-f-]{36}$/i.test(value))) return fail("Choose a saved booking container.", 400);
  const apply = body.action === "apply";
  if (body.action !== "preview" && !apply) return fail("Choose preview or apply.", 400);
  if (apply && !writable()) return fail("Dallas pilot writes are disabled in this environment.", 403);

  const db = staffDatabase();
  const [bookingResult, rowResult] = await Promise.all([
    db.from("cotton_outbound_bookings").select("terminal,site_code,customer,booking_number,status,return_location_code,return_location,updated_at").eq("id", id).maybeSingle(),
    db.from("cotton_outbound_containers").select("container_number,booking_line_id,carrier_plan,updated_at").match({ id: containerId, booking_id: id }).is("split_transfer_id", null).maybeSingle(),
  ]);
  if (bookingResult.error || rowResult.error) return fail("Could not load the booking container.", 503);
  const booking = bookingResult.data;
  const row = rowResult.data;
  if (!booking || !row) return fail("Booking container not found.", 404);
  const returnCode = bookingReturnLocation(booking.return_location_code || booking.return_location).return_location_code;
  if (booking.terminal !== "DAL" || booking.site_code !== "SCMDDETX" || booking.status !== "draft" ||
    returnCode !== "BNSFHATX" || bookingChargeCustomer(booking.customer)?.code !== "OLAMRITX") {
    return fail("The pilot is available for draft OLAM bookings from DeSoto to BNSF Haslet.", 422);
  }
  const mark = await db.from("cotton_outbound_booking_lines").select("line_status,load_source").eq("id", row.booking_line_id ?? id)
    .eq("booking_id", id).maybeSingle();
  if (mark.error) return fail("Could not load the booking mark.", 503);
  if (mark.data?.line_status !== "active" || mark.data.load_source !== "warehouse") {
    return fail("Choose a container assigned to an active warehouse mark.");
  }
  const savedPlan = row.carrier_plan;
  if (savedPlan && (key(savedPlan.rate?.carrier_id) !== "SCMIRIGA" ||
    (savedPlan.basePayOverride ?? savedPlan.rate?.rates?.base?.pay) !== 39293 ||
    savedPlan.rate?.rates?.base?.bill !== 54500 || Object.values(savedPlan.quantities ?? {}).some(count => count !== 0))) {
    return fail("The saved carrier plan differs from the standard SCMIRIGA Haslet pilot rates. Review the carrier details.");
  }
  const plan: DallasPilotPlan = {
    booking: key(booking.booking_number), container: key(row.container_number), bol: String(body.bol ?? "").trim(),
    orderedBy: String(body.orderedBy ?? "").trim(), early: String(body.early ?? ""), late: String(body.late ?? ""),
  };
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(plan.booking) || !/^[A-Z]{4}\d{7}$/.test(plan.container)) {
    return fail("Save a complete booking number and container number first.", 400);
  }
  if ([plan.bol, plan.orderedBy].some(value => value.length > 40 || /[\x00-\x1f]/.test(value))) return fail("Check the BOL and Ordered by fields.", 400);

  const match = { booking_number: plan.booking, container_number: plan.container };
  const journal = db.from("dallas_outbound_pilot_writes");
  const prior = await journal.select("state,order_id").match(match).maybeSingle();
  if (prior.error) return fail("The pilot write log is unavailable.", 503);
  if (prior.data && prior.data.state !== "verified") return fail(`A prior write requires McLeod review${prior.data.order_id ? ` for SCM order ${prior.data.order_id}` : ""}.`);

  const { read, write } = vendor(!apply);
  let order: any, review: ReturnType<typeof reviewDallasPilotOrder> | null, payload: ReturnType<typeof createDallasPilotPayload> | null;
  try {
    order = await findOrder(read, plan);
    review = order ? reviewDallasPilotOrder(order, plan) : null;
    payload = order ? null : createDallasPilotPayload(plan);
    if (prior.data && String(order?.id ?? "") !== prior.data.order_id) return fail("The prior SCM order could not be matched. Review it in McLeod.");
  } catch (reason) {
    return fail((reason as Error).message.startsWith("McLeod HTTP") ? "McLeod order search is unavailable." : (reason as Error).message);
  }
  const action = order ? "update" : "create";
  const fingerprint = hash({ plan, booking: booking.updated_at, row: row.updated_at, before: review?.before });
  const unchanged = Boolean(review && !review.billing && !review.movement);
  if (!apply) return NextResponse.json({ action, fingerprint, before: review?.before ?? null, unchanged, writable: writable() }, { headers });
  if (body.fingerprint !== fingerprint) return fail("The booking or McLeod order changed. Preview it again.");
  if (unchanged) return NextResponse.json({ orderId: String(order.id), unchanged: true }, { headers });

  const claim = prior.data
    ? await journal.update({ state: "writing", action, actor: staffActor(req) }).match(match).eq("state", "verified").select("state").maybeSingle()
    : await journal.insert({ ...match, state: "writing", action, order_id: order?.id ?? null, actor: staffActor(req) }).select("state").maybeSingle();
  if (claim.error || !claim.data) return fail("Another request claimed this booking container. Preview again.");

  let orderId: string | null = order ? String(order.id) : null;
  let attempted = false;
  try {
    const fresh = await findOrder(read, plan);
    if (orderId ? !fresh || hash(reviewDallasPilotOrder(fresh, plan).before) !== hash(review?.before) : fresh) {
      throw Error("The McLeod match changed. Preview it again.");
    }
    const [currentBooking, currentRow] = await Promise.all([
      db.from("cotton_outbound_bookings").select("id").match({ id, updated_at: booking.updated_at, status: "draft" }).maybeSingle(),
      db.from("cotton_outbound_containers").select("id").match({ id: containerId, booking_id: id, updated_at: row.updated_at }).is("split_transfer_id", null).maybeSingle(),
    ]);
    const currentMark = await db.from("cotton_outbound_booking_lines").select("id")
      .match({ id: row.booking_line_id, booking_id: id, line_status: "active", load_source: "warehouse" }).maybeSingle();
    if (currentBooking.error || currentRow.error || currentMark.error || !currentBooking.data || !currentRow.data || !currentMark.data)
      throw Error("The booking changed. Preview it again.");
    if (payload) {
      attempted = true;
      const created = await write("/orders/create", payload);
      const createdId = String(created?.id ?? "");
      if (!orderIdPattern.test(createdId)) throw Error("Create returned no SCM order number.");
      orderId = createdId;
      const recorded = await journal.update({ order_id: orderId }).match(match);
      if (recorded.error) throw Error("Could not record the created order.");
    }
    if (!orderId) throw Error("No SCM order number to verify.");
    const saved = payload ? await readOrder(read, orderId) : fresh;
    if (payload && (key(saved.blnum) !== key(plan.bol) || key(saved.ordered_by) !== key(plan.orderedBy)))
      throw Error("New order references did not verify.");
    const billing = reviewDallasPilotOrder(saved, plan);
    if (billing.billing) {
      attempted = true;
      await write("/orders/updateRow", billing.billing);
    }
    const afterBilling = reviewDallasPilotOrder(await readOrder(read, orderId), plan);
    if (afterBilling.billing) throw Error("Customer billing did not verify.");
    if (afterBilling.movement) {
      if (hash(afterBilling.movement) !== hash(billing.movement) ||
        ["payee", "pay", "payMethod", "payUnits", "payRate", "payeeRate"].some(field =>
          afterBilling.before[field] !== billing.before[field])) throw Error("Carrier pay changed during the request.");
      attempted = true;
      await write("/movement/update", afterBilling.movement);
      const pay = afterBilling.movement.override_pay_amt;
      await write(`/carrierDispatch/setPay/${encodeURIComponent(afterBilling.movement.id)}?method=F&units=1&rate=${pay}&carrierPay=${pay}`);
    }
    const verified = reviewDallasPilotOrder(await readOrder(read, orderId), plan);
    if (verified.billing || verified.movement) throw Error("Billing or carrier pay did not verify.");
    const completed = await journal.update({ state: "verified", order_id: orderId }).match(match).eq("state", "writing").select("state").maybeSingle();
    if (completed.error || !completed.data) throw Error("Could not complete the write log.");
    return NextResponse.json({ orderId }, { headers });
  } catch (reason) {
    if (!attempted) {
      if (prior.data) await journal.update({ state: "verified" }).match(match).eq("state", "writing");
      else await journal.delete().match(match).eq("state", "writing");
      return fail((reason as Error).message.startsWith("McLeod HTTP") ? "McLeod order search is unavailable." : (reason as Error).message);
    }
    await journal.update({ state: "review", order_id: orderId }).match(match).eq("state", "writing");
    return fail(`McLeod may have saved part of the request. Review ${orderId ? `SCM order ${orderId}` : "the booking and container"} in McLeod before retrying.`, 502);
  }
}

// The staff guard's default rule limits this financial write endpoint to administrators.
export const POST = withStaffAccess(handler);
