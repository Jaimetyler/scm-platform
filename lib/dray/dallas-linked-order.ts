import { mcleodOrderStops } from "../inbound/checkin/yard-stop";
import { vendor } from "./server";

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

function currentMovement(order: Awaited<ReturnType<typeof readLinkedDallasOrder>>) {
  const movement = Array.isArray(order.movements) && order.movements.length === 1 ? order.movements[0] : null;
  if (!movement || String(movement.id) !== String(order.curr_movement_id) ||
      !/^[A-Za-z0-9_-]{1,60}$/.test(String(movement.id)) ||
      (!Object.hasOwn(movement, "carrier_id") && !Object.hasOwn(movement, "vendor_id")))
    throw Error("Could not verify the assigned carrier on the current McLeod movement.");
  return movement;
}

function assignedCarrier(movement: ReturnType<typeof currentMovement>) {
  return [movement.carrier_id, movement.vendor_id].map(value => String(value ?? "").trim().toUpperCase()).find(Boolean);
}

export async function clearDallasCarrier(orderId: string, bookingNumber: string, link: DallasLink, plannedCarrier?: string) {
  const { read, write } = vendor(false);
  const readOrder = () => readLinkedDallasOrder(read, orderId, bookingNumber, link);
  const order = await readOrder();
  const movement = currentMovement(order);
  const carrier = assignedCarrier(movement);
  if (!carrier) return;
  if (plannedCarrier && carrier !== plannedCarrier.trim().toUpperCase())
    throw Error("McLeod has a different carrier on this load. Review its assignment before unassigning.");
  if ([order.status, order.__statusDescr, movement.status, movement.brokerage_status]
    .some(status => /^(D|B|DELIVERED|BILLED|FINISHED)$/i.test(String(status ?? "").trim())))
    throw Error("Review the completed movement in McLeod before changing its carrier.");

  const reason = new URLSearchParams({ reason: "Outbound load plan unassignment" });
  let writeError: unknown;
  try {
    await write(`/carrierDispatch/clearCarrier/${movement.id}?${reason}`);
  } catch (error) {
    writeError = error;
  }
  const updated = currentMovement(await readOrder());
  if (String(updated.id) !== String(movement.id) || assignedCarrier(updated))
    throw new Error("McLeod could not verify carrier removal. Review the movement before retrying.", { cause: writeError });
}
