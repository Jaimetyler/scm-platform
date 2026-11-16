import { mcleodOrderStops } from "../inbound/checkin/yard-stop";
import { vendor } from "./server";
import { dallasExtraPayToRemove, readDallasExtraPay } from "./dallas-extra-pay";
import type { CarrierPlan } from "../warehouse/outbound/carrier-rates";

type DallasLink = { blnum: string; payload: { customer_id: string; stops: { stop_type: string; location_id: string }[] } };
type ReadOrder = ReturnType<typeof vendor>["read"];

export async function readLinkedDallasOrder(read: ReadOrder, orderId: string, bookingNumber: string, link: DallasLink) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw Error("Choose a verified SCM order.");
  const order = await read(`/orders/${orderId}`);
  const remoteBooking = String(order?.booking_no_sucm ?? "").trim();
  const blnum = String(order?.blnum ?? "").trim().split(/\s+/)[0];
  if (String(order?.id) !== orderId || order.revenue_code_id !== "DDRAY" || order.customer_id !== link.payload.customer_id ||
      (blnum !== link.blnum && remoteBooking !== bookingNumber) || (remoteBooking && remoteBooking !== bookingNumber) ||
      [order.status, order.__statusDescr].some(status => /^(V|VOID|VOIDED|CANCELED|CANCELLED)$/i.test(String(status ?? "").trim())))
    throw Error("McLeod order identity could not be verified.");
  const stops = mcleodOrderStops(order);
  if (!link.payload.stops.every(stop => stops.some(actual => actual.stop_type === stop.stop_type && actual.location_id === stop.location_id)))
    throw Error("McLeod pickup and delivery could not be verified.");
  return order;
}

export async function prepareDallasBlnumReset(orderId: string, bookingNumber: string, link: DallasLink) {
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}-[1-9]\d{0,2}$/.test(link.blnum))
    throw Error("The original Dallas load reference could not be verified.");
  const { read, write } = vendor(false);
  const readOrder = () => readLinkedDallasOrder(read, orderId, bookingNumber, link);
  const before = await readOrder();
  const reference = (order: typeof before) => String(order.blnum ?? "").trim();
  return async () => {
    const current = await readOrder();
    if (reference(current) === link.blnum) return;
    if (reference(current) !== reference(before))
      throw Error("The McLeod BLNUM changed during unassign. Reload and review the order.");
    if (current.status !== "A") throw Error("McLeod must show the order as available to reset its BLNUM.");
    let writeError: unknown;
    try {
      await write("/orders/updateRow", { __type: "orders", company_id: "TMS", id: orderId, blnum: link.blnum });
    } catch (error) {
      writeError = error;
    }
    if (reference(await readOrder()) !== link.blnum)
      throw new Error("McLeod did not verify the original BLNUM. Review the order before retrying.", { cause: writeError });
  };
}

export function currentDallasMovement(order: Awaited<ReturnType<typeof readLinkedDallasOrder>>) {
  const id = String(order.curr_movement_id ?? "");
  const matches = Array.isArray(order.movements) ? order.movements.filter(item => String(item?.id) === id) : [];
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{1,60}$/.test(id))
    throw Error("Could not identify the current McLeod movement for this order.");
  return matches[0];
}

function assignedCarrier(movement: ReturnType<typeof currentDallasMovement>) {
  return [movement.carrier_id, movement.vendor_id, movement.carrier?.id, movement.vendor?.id]
    .map(value => String(value ?? "").trim().toUpperCase()).find(Boolean);
}

async function readCarrierMovement(read: ReadOrder, order: Awaited<ReturnType<typeof readLinkedDallasOrder>>) {
  const movement = currentDallasMovement(order);
  const hasCarrierFields = (row: typeof movement) =>
    ["carrier_id", "vendor_id", "carrier", "vendor"].some(field => Object.hasOwn(row, field));
  if (hasCarrierFields(movement)) return movement;
  const full = await read(`/movements/${movement.id}`);
  if (String(full?.id) !== String(movement.id))
    throw Error("Could not verify the current McLeod movement details.");
  const brokerageStatus = String(full.__brokerageStatusDescr ?? full.brokerage_status ?? "").trim();
  if (!hasCarrierFields(full) && !/^(AVAILABLE|UNASSIGNED|UNCOVERED)$/i.test(brokerageStatus))
    throw Error("McLeod did not return carrier assignment fields or an unassigned brokerage status.");
  return full;
}

export async function clearDallasCarrier(orderId: string, bookingNumber: string, link: DallasLink, plan?: CarrierPlan | null) {
  const { read, write, deleteOtherPay } = vendor(false);
  const readOrder = () => readLinkedDallasOrder(read, orderId, bookingNumber, link);
  const order = await readOrder();
  const movement = await readCarrierMovement(read, order);
  const carrier = assignedCarrier(movement);
  const plannedCarrier = plan?.rate.carrier_id.trim().toUpperCase();
  if (carrier && plannedCarrier && carrier !== plannedCarrier)
    throw Error("McLeod has a different carrier on this load. Review its assignment before unassigning.");
  if (!carrier && !plan) return;
  if ([order.status, order.__statusDescr, movement.status, movement.brokerage_status]
    .some(status => /^(D|B|DELIVERED|BILLED|FINISHED)$/i.test(String(status ?? "").trim())))
    throw Error("Review the completed movement in McLeod before changing its carrier.");

  const readPay = () => readDallasExtraPay(read, String(movement.id));
  const payee = plannedCarrier || carrier;
  const targets = payee ? dallasExtraPayToRemove(await readPay(), { orderId, movementId: String(movement.id), payee, plan }) : [];
  if (carrier) {
    const reason = new URLSearchParams({ reason: "Outbound load plan unassignment" });
    let writeError: unknown;
    try {
      await write(`/carrierDispatch/clearCarrier/${movement.id}?${reason}`);
    } catch (error) {
      writeError = error;
    }
    const updated = await readCarrierMovement(read, await readOrder());
    if (String(updated.id) !== String(movement.id) || assignedCarrier(updated))
      throw new Error("McLeod could not verify carrier removal. Review the movement before retrying.", { cause: writeError });
  }

  // Use the saved plan on retry when carrier removal succeeded but pay cleanup did not.
  for (const target of targets) {
    const currentPay = await readPay();
    const remaining = currentPay.filter(row => row.id === target.id);
    if (!remaining.length) continue;
    if (remaining.length !== 1 || !dallasExtraPayToRemove(remaining, { orderId, movementId: String(movement.id), payee: payee!, plan }).length)
      throw Error("Other Carrier Pay changed during unassign. Review the movement before retrying.");
    try {
      await deleteOtherPay(target.id);
    } catch (error) {
      if ((await readPay()).some(row => row.id === target.id))
        throw new Error("Carrier cleared, but McLeod could not remove Other Carrier Pay. Review the movement before retrying.", { cause: error });
    }
    if ((await readPay()).some(row => row.id === target.id))
      throw Error("Carrier cleared, but Other Carrier Pay remains in McLeod. Review the movement before retrying.");
  }
}
