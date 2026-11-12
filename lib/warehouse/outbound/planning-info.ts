import { extractSearchOrders } from "../../mcleod/inbound/search-response.ts";
import { mcleodOrderStops, stopAtScmYard } from "../../inbound/checkin/yard-stop.ts";
import type { CheckinSite } from "../../inbound/checkin/sites.ts";

export type PlanningInfo = {
  checkedAt: string; matchedOrders: number; uncovered: number; unknownCarriers: number;
  carriers: string[]; uncoveredOrderIds: string[]; complete: boolean;
};
const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => text(value).toUpperCase();

export function dallasOrderBookingReferences(order: { booking_no_sucm?: unknown; planning_comment?: unknown }) {
  const references = [...key(order.planning_comment).matchAll(/\b(?:BKG|BOOKING)\s*[:#]\s*([A-Z0-9][A-Z0-9._/-]*)/g)]
    .map(match => match[1].replace(/[./-]+$/, ""));
  return new Set([key(order.booking_no_sucm), ...references].filter(Boolean));
}

export async function readDallasBookingOrders(read: (path: string) => Promise<unknown>,
  bookingNumber: string, site: CheckinSite,
  customerIds: readonly string[], signal: AbortSignal) {
  const reference = key(bookingNumber);
  if (!reference || /[\u0000-\u001f*?]/.test(reference)) throw Error("Booking number is not suitable for lookup.");
  async function search(field: string, value: string) {
    const ids = new Set<string>();
    for (let page = 0; page < 20; page++) {
      signal.throwIfAborted();
      const query = new URLSearchParams({ [field]: value, "orders.revenue_code_id": "DDRAY", recordLength: "5", recordOffset: String(page * 5) });
      const rows = extractSearchOrders(await read(`/orders/search?${query}`));
      if (!rows || rows.length > 5) throw Error("McLeod returned an incomplete booking search.");
      for (const row of rows) {
        const id = text(row && typeof row === "object" ? (row as Record<string, unknown>).id : null);
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(id) || ids.has(id)) throw Error("McLeod search could not establish a complete order list.");
        ids.add(id);
      }
      if (rows.length < 5) return ids;
    }
    throw Error("Too many booking orders to verify completely. Narrow the lookup before using coverage.");
  }

  const [structured, comments] = await Promise.allSettled([
    search("orders.booking_no_sucm", reference),
    search("orders.planning_comment", `*${reference}*`),
  ]);
  signal.throwIfAborted();
  if (structured.status === "rejected" && comments.status === "rejected") throw structured.reason;
  const ids = new Set([
    ...(structured.status === "fulfilled" ? structured.value : []),
    ...(comments.status === "fulfilled" ? comments.value : []),
  ]);
  const matched: Record<string, any>[] = [];
  for (const id of ids) {
    signal.throwIfAborted();
    const order = await read(`/orders/${encodeURIComponent(id)}`) as Record<string, any> | null;
    if (!order || text(order.id) !== id || !order.customer_id || !order.revenue_code_id)
      throw Error("McLeod order identity could not be verified.");
    const references = dallasOrderBookingReferences(order);
    if (references.size !== 1 || !references.has(reference) || key(order.revenue_code_id) !== "DDRAY" ||
        !customerIds.includes(key(order.customer_id)) || /^(V|VOID|VOIDED|CANCELLED|CANCELED)$/i.test(text(order.__statusDescr || order.status))) continue;
    const pickups = mcleodOrderStops(order).filter(stop => key(stop.stop_type) === "PU" && stopAtScmYard(stop, site.siteName, site.terminal));
    if (pickups.length !== 1) continue;
    matched.push({ ...order, warehousePickup: pickups[0] });
  }
  if (!matched.length && (structured.status === "rejected" || comments.status === "rejected"))
    throw Error("One of the McLeod booking searches could not be completed.");
  return matched;
}

export async function readPlanningInfo(
  read: (path: string) => Promise<unknown>,
  booking: { booking_number: string; planned_containers: number | null }, site: CheckinSite,
  customerIds: readonly string[], signal: AbortSignal,
): Promise<PlanningInfo> {
  const matched = await readDallasBookingOrders(read, booking.booking_number, site, customerIds, signal);
  const uncoveredOrderIds: string[] = [];
  let unknownCarriers = 0;
  const carriers = new Set<string>();
  for (const order of matched) {
    const movements = Array.isArray(order.movements) ? order.movements : [];
    const pickup = order.warehousePickup;
    const linked = movements.filter((movement: Record<string, any>) => text(pickup.movement_id)
      ? text(movement.id) === text(pickup.movement_id)
      : Array.isArray(movement.stops) && movement.stops.some((stop: Record<string, any>) => text(stop.id) === text(pickup.id)));
    const movement = linked.length === 1 ? linked[0] : !text(pickup.movement_id) && movements.length === 1 ? movements[0] : null;
    const fields = ["carrier_id", "vendor_id", "override_payee_id"];
    if (!movement || !fields.some(field => Object.hasOwn(movement, field))) unknownCarriers++;
    else {
      const code = fields.map(field => text(movement[field])).find(Boolean);
      const named = [movement.carrier, movement.vendor, movement.payee].map(value => text(value?.name)).find(Boolean) || text(movement.carrier_name || movement.vendor_name);
      if (code || named) carriers.add(named || code!);
      else uncoveredOrderIds.push(text(order.id));
    }
  }
  // A successful empty lookup is not evidence that any trucks are uncovered.
  const complete = matched.length > 0 && unknownCarriers === 0 && booking.planned_containers != null && matched.length === booking.planned_containers;
  return { checkedAt: new Date().toISOString(), matchedOrders: matched.length, uncovered: uncoveredOrderIds.length, unknownCarriers,
    carriers: [...carriers].sort(), uncoveredOrderIds, complete };
}
