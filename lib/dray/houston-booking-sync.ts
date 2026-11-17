import type { Ledger, Vendor } from "./engine.ts";
import { expectedCharges, verifyRatedOrder } from "./mcleod.ts";
import type { DrayInvoice } from "./model.ts";

type ChargeRow = Record<string, any>;
type SyncVendor = Vendor & { deleteCustomerCharge: (id: string) => Promise<unknown> };
type Source = Pick<Ledger, "invoice" | "profile">;
const chargeKey = (row: ChargeRow) => JSON.stringify([row.charge_id, String(row.descr ?? row.description ?? "").trim()]);
const cents = (value: unknown) => Math.round(Number(value) * 100);
const chargeRows = (order: any): ChargeRow[] => order.otherCharges ?? order.other_charges ?? order.otherCharge ?? [];

export function planHoustonBookingSync(before: any, previous: Source, desired: Source, orderId: string, resume = false) {
  if (previous.profile.id !== "HOU-5300-BOOKING" || desired.profile.id !== previous.profile.id ||
      previous.profile.terminal !== "HOU" || desired.profile.terminal !== "HOU" || String(before.id) !== orderId)
    throw Error("Choose a verified Houston booking order.");
  const old = previous.invoice as DrayInvoice;
  const next = desired.invoice as DrayInvoice;
  for (const field of ["reference", "mark", "customerId", "booking", "fileNumber", "customerOrder", "invoiceDate", "destination"] as const)
    if (String(old[field] ?? "") !== String(next[field] ?? ""))
      throw Error("Booking references or order date changed. Review them before syncing charges.");
  if (old.baseCents !== next.baseCents) throw Error("The customer base rate changed. Review the base rate before syncing accessorials.");
  const signature = (charge: ChargeRow) => JSON.stringify([chargeKey(charge), Number(charge.units), Number(charge.rate), cents(charge.amount)]);
  const approved = new Set([...expectedCharges(previous.invoice, previous.profile), ...expectedCharges(desired.invoice, desired.profile)].map(signature));
  const paymentErrors = ["Movement payee or zero-payment settings differ from approved profile", "Carrier payment settings differ from FirstStar"];
  const rawCharges = before.otherCharges ?? before.other_charges ?? before.otherCharge;
  const verifiedEmpty = rawCharges == null && before.otherchargetotal != null && Number(before.otherchargetotal) === 0 &&
    [old.baseCents, old.cents, next.cents].includes(cents(before.total_charge));
  const desiredErrors = verifyRatedOrder(before, desired.invoice, desired.profile);
  const errors = verifyRatedOrder(before, previous.invoice, previous.profile).filter(error => {
    if (!resume) return true;
    if (error === "Charges unavailable" || error === "Charge lines differ from source invoice")
      return (!Array.isArray(rawCharges) && !verifiedEmpty) ||
        chargeRows(before).some(charge => !approved.has(signature(charge)));
    if (error === "McLeod order total differs from source invoice") {
      const actual = old.baseCents + chargeRows(before).reduce((sum, charge) => sum + cents(charge.amount), 0);
      return ![old.cents, next.cents, actual].includes(cents(before.total_charge));
    }
    if (paymentErrors.includes(error)) return desiredErrors.some(error => paymentErrors.includes(error));
    return true;
  });
  if (errors.length) throw Error("McLeod differs from the last verified import: " + errors.join("; "));
  if (before.status !== "A" || !Array.isArray(before.stops) ||
      before.stops.some((stop: any) => stop.status !== "A" || stop.actual_arrival || stop.actual_departure))
    throw Error("Only available, unstarted Houston orders can sync financial changes.");
  if (!Array.isArray(before.movements) || before.movements.length !== 1 || !before.movements[0].id ||
      before.movements[0].status !== "A")
    throw Error("A single available movement is required.");
  const movement = before.movements[0];
  if (String(before.curr_movement_id ?? "") && String(before.curr_movement_id) !== String(movement.id))
    throw Error("The current McLeod movement changed.");
  const assigned = String(movement.carrier_id ?? movement.vendor_id ?? "").trim();
  if (assigned && assigned.toUpperCase() !== desired.profile.payee)
    throw Error("McLeod has a different dispatched carrier. Review the carrier assignment first.");
  const current = chargeRows(before);
  const allowedRows = resume ? [...expectedCharges(previous.invoice, previous.profile), ...expectedCharges(desired.invoice, desired.profile)]
    : expectedCharges(previous.invoice, previous.profile);
  const allowedSignatures = new Set(allowedRows.map(signature));
  if (current.some(charge => !allowedSignatures.has(signature(charge)) ||
      !["N", "FALSE", "0"].includes(String(charge.incl_in_freight ?? "").toUpperCase())))
    throw Error("McLeod customer charge values or freight classification changed. Review before syncing.");
  const expected = expectedCharges(desired.invoice, desired.profile);
  if (new Set(current.map(chargeKey)).size !== current.length || new Set(expected.map(chargeKey)).size !== expected.length)
    throw Error("Duplicate customer charge lines require review.");
  const target = new Map(expected.map(row => [chargeKey(row), row]));
  const changes = current.flatMap(row => {
    const line = target.get(chargeKey(row));
    if (line) target.delete(chargeKey(row));
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(row.id ?? ""))) throw Error("McLeod customer charge ID could not be verified.");
    if (line && Number(row.units) === Number(line.units) && cents(row.amount) === cents(line.amount) && Number(row.rate) === Number(line.rate))
      return [];
    return [{ previous: row, desired: line ?? null }];
  });
  for (const line of target.values()) changes.push({ previous: null as any, desired: line });
  const payChanged = previous.profile.payee !== desired.profile.payee || old.carrierCents !== next.carrierCents;
  return { changes, payChanged, movementId: String(movement.id), bill: next.cents / 100, pay: next.carrierCents! / 100 };
}

export async function syncHoustonBookingCharges(row: Ledger, previous: Source, vendor: SyncVendor, resume = false) {
  const path = "/orders/" + encodeURIComponent(row.order_id!);
  const before = await vendor.read(path);
  const plan = planHoustonBookingSync(before, previous, row, row.order_id!, resume);
  const snapshot = (order: any) => JSON.stringify([order.status, order.rate_type, order.rate, order.rate_units,
    order.total_charge, chargeRows(order), order.movements, order.stops]);
  let state = before;
  for (const change of plan.changes) {
    const fresh = await vendor.read(path);
    if (snapshot(fresh) !== snapshot(state)) throw Error("McLeod changed during charge sync. Check the existing order.");
    if (!change.desired) await vendor.deleteCustomerCharge(String(change.previous.id));
    else await vendor.write(change.previous ? "/other_charge/update" : "/other_charge/create", {
      ...(change.previous ?? {}), ...change.desired, __type: "other_charge", company_id: "TMS", order_id: row.order_id,
      ...(change.previous ? { id: change.previous.id } : {}),
    });
    state = await vendor.read(path);
    const remaining = chargeRows(state);
    const matches = remaining.filter(charge => chargeKey(charge) === chargeKey(change.previous ?? change.desired!));
    if (!change.desired ? matches.length !== 0 : matches.length !== 1 ||
        cents(matches[0].amount) !== cents(change.desired.amount) || Number(matches[0].units) !== Number(change.desired.units) ||
        Number(matches[0].rate) !== Number(change.desired.rate))
      throw Error("The McLeod customer charge did not verify after sync.");
    const unaffected = (order: any) => chargeRows(order).filter(charge =>
      chargeKey(charge) !== chargeKey(change.previous ?? change.desired!));
    if (JSON.stringify(unaffected(state)) !== JSON.stringify(unaffected(fresh)) ||
        JSON.stringify(state.stops) !== JSON.stringify(fresh.stops) || JSON.stringify(state.movements) !== JSON.stringify(fresh.movements) ||
        state.status !== fresh.status || state.rate !== fresh.rate || state.rate_units !== fresh.rate_units || state.rate_type !== fresh.rate_type)
      throw Error("Another McLeod field changed during charge sync.");
  }
  let fresh = await vendor.read(path);
  if (snapshot(fresh) !== snapshot(state)) throw Error("McLeod changed before bill verification.");
  if (cents(fresh.total_charge) !== row.invoice.cents) {
    await vendor.write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: row.order_id, total_charge: plan.bill });
    state = await vendor.read(path);
    if (JSON.stringify(chargeRows(state)) !== JSON.stringify(chargeRows(fresh)) ||
        JSON.stringify(state.movements) !== JSON.stringify(fresh.movements) ||
        JSON.stringify(state.stops) !== JSON.stringify(fresh.stops) || state.rate !== fresh.rate || state.status !== fresh.status)
      throw Error("McLeod billing changed during total verification.");
  }
  if (plan.payChanged) {
    fresh = await vendor.read(path);
    if (snapshot(fresh) !== snapshot(state)) throw Error("McLeod changed before carrier pay sync.");
    await vendor.write("/movement/update", {
      __type: "movement", company_id: "TMS", id: plan.movementId,
      override_payee_id: row.profile.payee, override_type: "F", override_units: 1,
      override_paye_rate: plan.pay, override_pay_rate: plan.pay, override_pay_amt: plan.pay,
    });
    await vendor.write("/carrierDispatch/setPay/" + encodeURIComponent(plan.movementId) +
      `?method=F&units=1&rate=${plan.pay}&carrierPay=${plan.pay}`);
  }
  const after = await vendor.read(path);
  const errors = verifyRatedOrder(after, row.invoice, row.profile);
  if (after.status !== "A" || after.stops.some((stop: any) => stop.status !== "A" || stop.actual_arrival || stop.actual_departure))
    errors.push("Order progressed during financial sync");
  if (errors.length) throw Error("Houston financial sync did not verify: " + errors.join("; "));
}
