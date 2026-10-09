import { selectMcleodYardStop, stopAtScmYard } from "./yard-stop.ts";
import { dependencyFetch, DependencyError } from "../../http/dependency.ts";
export type McleodCompletion = {
  kind: "pickup" | "delivery" | "closed" | "cancelled";
  message: string; completedAt: string; location: string;
  carrierName: string; carrierCode: string;
};

// A closed order is a search result, but never a selectable new arrival.
export async function describeMcleodCompletion(
  order: Record<string, any>, stop: Record<string, any> | undefined,
  direction: string, signal?: AbortSignal,
): Promise<McleodCompletion | null> {
  const text = (value: unknown) => String(value ?? "").trim();
  const status = text(order.__statusDescr || order.status);
  const departed = text(stop?.actual_departure);
  const cancelled = /^(cancelled|canceled)$/i.test(status);
  const closed = /^(delivered|completed|closed|D)$/i.test(status);
  if (!departed && !cancelled && !closed) return null;
  const kind = departed ? (direction === "pickup" ? "pickup" : "delivery") : cancelled ? "cancelled" : "closed";
  const message = kind === "pickup" ? "Pickup already completed in McLeod" :
    kind === "delivery" ? "Delivery already completed in McLeod" :
    kind === "cancelled" ? "Order cancelled in McLeod" : "Order already closed out in McLeod";
  const movements: Record<string, any>[] = Array.isArray(order.movements) ? order.movements : [];
  // Do not attribute an earlier stop to the order's current carrier on a relay.
  const movementId = text(stop?.movement_id);
  const stopId = text(stop?.id);
  const linked = movements.filter((item) => movementId ? text(item.id) === movementId :
    stopId && Array.isArray(item.stops) && item.stops.some((candidate: Record<string, unknown>) => text(candidate.id) === stopId));
  const movement = linked.length === 1 ? linked[0] :
    !movementId && linked.length === 0 && movements.length === 1 ? movements[0] : undefined;
  const named = (value: any) => value && typeof value === "object" ? text(value.name) : "";
  let carrierCode = text(movement?.carrier_id || movement?.vendor_id || movement?.override_payee_id);
  let carrierName = named(movement?.carrier) || named(movement?.vendor) || named(movement?.payee) ||
    text(movement?.carrier_name || movement?.vendor_name);
  // With no movement records, McLeod may provide only the order-level carrier.
  if (!movementId && movements.length === 0) {
    carrierCode = text(order.vendor_id);
    carrierName = named(order.carrier) || named(order.vendor) || text(order.carrier_name);
  }
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!carrierName && carrierCode && base && token) {
    for (const path of ["carriers", "vendors"]) {
      try {
        const response = await dependencyFetch(`${base}/${path}/${encodeURIComponent(carrierCode)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal,
        });
        if (response.ok) carrierName = named(await response.json());
        if (carrierName) break;
      } catch { /* Completion remains visible when carrier enrichment fails. */ }
    }
  }
  const location = stop?.location && typeof stop.location === "object" ? stop.location : {};
  return { kind, message, completedAt: departed, carrierName, carrierCode,
    location: [location.name || stop?.location_name, location.address1 || location.address || stop?.address,
      location.city_name || stop?.city_name, location.state || stop?.state].map(text).filter(Boolean).join(", ") };
}

export async function lookupMcleodOrderById(orderId: string, direction: string) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw new Error("Enter a valid McLeod order ID");
  if (direction !== "pickup" && direction !== "delivery") throw new Error("Choose pickup or delivery");
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw new Error("McLeod connection is not configured");
  const response = await dependencyFetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`McLeod order lookup failed (${response.status})`);
  const order = await response.json();
  if (String(order.revenue_code_id ?? "").trim().toUpperCase() !== "MAIN")
    throw new Error(`SCM order ${orderId} is not a MAIN revenue code order`);
  const field = direction === "pickup" ? "blnum" : "consignee_refno";
  const reference = String(order[field] ?? "").trim().toUpperCase();
  const customer = String(order.customer?.name ?? order.customer_name ?? order.customer_id ?? "").trim().toUpperCase();
  const delivery = (Array.isArray(order.stops) ? order.stops : []).find((stop: Record<string, unknown>) => stop.stop_type === "SO");
  const pickup = (Array.isArray(order.stops) ? order.stops : []).find((stop: Record<string, unknown>) => stop.stop_type === "PU");
  const destination = String(delivery?.location?.name ?? delivery?.location_name ?? "").trim().toUpperCase();
  const commodity = String(order.commodity?.description ?? order.commodity_description ?? order.commodity_id ?? order.commodity ?? "").toUpperCase();
  const materialType = /\bCOTTON\b/.test(commodity) ? "cotton" :
    /\bLUMBER\b|\bWOOD\b/.test(commodity) ? "lumber" : /\bOTHER\b|\bFAK\b/.test(commodity) ? "other" : null;
  if (!reference) throw new Error(`McLeod order ${orderId} has no ${field}`);
  if (!customer) throw new Error(`McLeod order ${orderId} has no customer`);
  const stop = direction === "pickup" ? pickup : delivery;
  return { orderId, field, reference, customer, destination, materialType,
    actualDeparture: String(stop?.actual_departure ?? "").trim() };
}

export async function lookupMcleodGateOrder(orderId: string, terminal: "SAV" | "HOU", siteName: string, requestedDirection?: "pickup" | "delivery", selectedStopId?: string | null, providedOrder?: Record<string, any>, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw new Error("Enter a valid SCM order number");
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw new Error("McLeod connection is not configured");
  let order = providedOrder;
  if (!order) {
    let response: Response;
    try { response = await dependencyFetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal,
    }); } catch { throw new DependencyError("McLeod lookup is temporarily unavailable. Please try again."); }
    if (!response.ok) {
      if (response.status === 404) throw new Error("SCM order number not found");
      throw new DependencyError("McLeod lookup is temporarily unavailable. Please try again.");
    }
    order = await response.json();
  }
  if (String(order.revenue_code_id ?? "").trim().toUpperCase() !== "MAIN")
    throw new Error(`SCM order ${orderId} is not a MAIN revenue code order. Check in using the reference from your paperwork.`);
  const selection = selectMcleodYardStop(order, terminal, siteName, requestedDirection, selectedStopId);
  const { stops, stop, direction, movement } = selection;
  const field = direction === "pickup" ? "blnum" : "consignee_refno";
  const reference = String(order[field] ?? "").trim().toUpperCase();
  const customer = String(order.customer?.name ?? order.customer_name ?? order.customer_id ?? "").trim().toUpperCase();
  if (!reference || !customer) throw new Error("This order is missing check-in details. Check in with the reference from your paperwork instead.");
  const commodity = String(order.commodity?.description ?? order.commodity?.name ?? order.commodity_description ?? order.commodity_desc ?? order.commodity_id ?? order.commodity ?? "").trim().toUpperCase();
  const materialType = /\bCOTTON\b/.test(commodity) ? "cotton" : /\bLUMBER\b|\bWOOD\b/.test(commodity) ? "lumber" : /\bOTHER\b|\bFAK\b/.test(commodity) ? "other" : null;
  const blnum = String(order.blnum ?? "").trim().toUpperCase();
  const parsedBlnum = blnum.match(/^(.+?)\s+(\d+)\s+(?:BALES?|B\/?C|BC)$/);
  const mark = String(order.consignee_refno ?? "").trim().toUpperCase() || parsedBlnum?.[1] || "";
  const baleCount = parsedBlnum?.[2] ?? "";
  const soleUnlistedMovement = order.movements?.length === 1 && !Array.isArray(order.movements[0].stops);
  const deliveries = stops.filter((item: Record<string, unknown>) => item.stop_type === "SO" &&
    (!order.movements?.length || movement?.id && (String(item.movement_id ?? "").trim() === String(movement.id) ||
      (!String(item.movement_id ?? "").trim() && soleUnlistedMovement))));
  const delivery = direction === "delivery" ? stop : deliveries.length === 1 ? deliveries[0] : undefined;
  const deliveryLocation = delivery?.location && typeof delivery.location === "object"
    ? delivery.location as Record<string, unknown> : {};
  const destination = String(deliveryLocation.name ?? delivery?.location_name ??
    [delivery?.city_name, delivery?.state].filter(Boolean).join(", ")).trim().toUpperCase();
  const driverName = String(movement?.override_driver_nm ?? "").trim();
  const driverPhone = String(movement?.override_drvr_cell ?? "").trim();
  const carrierCode = String(movement?.carrier_id ?? movement?.vendor_id ?? movement?.override_payee_id ?? (!order.movements?.length ? order.vendor_id : "") ?? "").trim();
  const named = (value: unknown) => value && typeof value === "object"
    ? String((value as Record<string, unknown>).name ?? "").trim() : "";
  let carrierName = named(movement?.carrier) || named(movement?.vendor) || named(movement?.payee) ||
    (!order.movements?.length ? named(order.carrier) || named(order.vendor) : "") ||
    String(movement?.carrier_name ?? movement?.vendor_name ?? (!order.movements?.length ? order.carrier_name : "") ?? "").trim();
  if (!carrierName && carrierCode) {
    for (const path of ["carriers", "vendors"]) {
      try {
        const carrierResponse = await dependencyFetch(`${base}/${path}/${encodeURIComponent(carrierCode)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal,
        });
        if (carrierResponse.ok) carrierName = named(await carrierResponse.json());
        if (carrierName) break;
      } catch { /* The order can still be used when the carrier endpoint is unavailable. */ }
    }
  }
  const orderDate = String(stop.sched_arrive_early ?? stop.sched_arrive_late ?? order.ordered_date ?? "").trim();
  // Prerequisite actuals may only come from the selected stop's movement.
  // Display-only lookup can still succeed without linkage; checkout checks this flag.
  const allPickups = stops.filter((item: Record<string, unknown>) => item.stop_type === "PU");
  const singleUnlistedMovement = soleUnlistedMovement;
  const pickupMovementVerified = Boolean(movement?.id) && (singleUnlistedMovement ||
    allPickups.every((item: Record<string, unknown>) => String(item.movement_id ?? "").trim()));
  const pickupStops = pickupMovementVerified ? allPickups.filter((item: Record<string, unknown>) =>
    String(item.movement_id ?? "").trim() === String(movement!.id) ||
    (!String(item.movement_id ?? "").trim() && singleUnlistedMovement)) : [];
  // A pickup at the receiving yard may be a later outbound visit. Without
  // trusted sequencing, never invent its actuals to complete this delivery.
  const pickupBackfillVerified = !pickupStops.some((item: Record<string, unknown>) =>
    (!String(item.actual_arrival ?? "").trim() || !String(item.actual_departure ?? "").trim()) &&
    stopAtScmYard(item, siteName, terminal));
  const orderStatus = String(order.__statusDescr ?? movement?.__statusDescr ?? order.status ?? "").trim();
  return { direction, reference, customer, commodity, materialType, mark, baleCount,
    destination, driverName, driverPhone, carrierName, carrierCode, orderDate, orderStatus,
    stopId: String(stop.id ?? ""), movementId: String(movement?.id ?? stop.movement_id ?? ""), actualArrival: String(stop.actual_arrival ?? ""), actualDeparture: String(stop.actual_departure ?? ""),
    completion: await describeMcleodCompletion(order, stop, direction, signal),
    pickupMovementVerified, pickupBackfillVerified, pickupStops: pickupStops
      .map((item: Record<string, unknown>) => ({ id: String(item.id ?? ""),
        actual_arrival: String(item.actual_arrival ?? ""), actual_departure: String(item.actual_departure ?? "") })) };
}
