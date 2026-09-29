export async function lookupMcleodOrderById(orderId: string, direction: string) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw new Error("Enter a valid McLeod order ID");
  if (direction !== "pickup" && direction !== "delivery") throw new Error("Choose pickup or delivery");
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw new Error("McLeod connection is not configured");
  const response = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
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

export async function lookupMcleodGateOrder(orderId: string, terminal: "SAV" | "HOU", siteName: string) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw new Error("Enter a valid SCM order number");
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw new Error("McLeod connection is not configured");
  const response = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 404 ? "SCM order number not found" : `McLeod order lookup failed (${response.status})`);
  const order = await response.json();
  if (String(order.revenue_code_id ?? "").trim().toUpperCase() !== "MAIN")
    throw new Error(`SCM order ${orderId} is not a MAIN revenue code order. Check in using the reference from your paperwork.`);
  const stops = Array.isArray(order.stops) ? order.stops : [];
  const city = terminal === "SAV" ? "SAVANNAH" : "HOUSTON";
  const siteWords = siteName.toUpperCase().match(/\b\d{3,}\b/g) ?? [];
  function atSite(stop: Record<string, unknown>) {
    const location = stop.location && typeof stop.location === "object" ? stop.location as Record<string, unknown> : {};
    const name = String(location.name ?? stop.location_name ?? "").toUpperCase();
    const address = String(location.address ?? location.address1 ?? stop.address ?? "").toUpperCase();
    const stopCity = String(location.city ?? stop.city ?? "").toUpperCase();
    const scm = /\bSCM\b|SUPPLY CHAIN|SAVANNAH WAREHOUSE|HOUSTON WAREHOUSE/.test(name);
    return scm && (name.includes(city) || stopCity.includes(city) || siteWords.some((word) => name.includes(word) || address.includes(word)));
  }
  const pickups = stops.filter((stop: Record<string, unknown>) => stop.stop_type === "PU" && atSite(stop));
  const deliveries = stops.filter((stop: Record<string, unknown>) => stop.stop_type === "SO" && atSite(stop));
  if (pickups.length + deliveries.length !== 1) throw new Error("Could not identify this SCM yard on the order. Check in with the reference from your paperwork instead.");
  const direction = pickups.length ? "pickup" : "delivery";
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
  const delivery = stops.find((item: Record<string, unknown>) => item.stop_type === "SO") as Record<string, unknown> | undefined;
  const deliveryLocation = delivery?.location && typeof delivery.location === "object"
    ? delivery.location as Record<string, unknown> : {};
  const destination = String(deliveryLocation.name ?? delivery?.location_name ??
    [delivery?.city_name, delivery?.state].filter(Boolean).join(", ")).trim().toUpperCase();
  const movements = Array.isArray(order.movements) ? order.movements as Record<string, unknown>[] : [];
  const movement = movements.find((item) => String(item.id ?? "") === String(order.curr_movement_id ?? "")) ?? movements[0];
  const driverName = String(movement?.override_driver_nm ?? "").trim();
  const driverPhone = String(movement?.override_drvr_cell ?? "").trim();
  const stop = (pickups[0] ?? deliveries[0]) as Record<string, unknown>;
  const carrierCode = String(movement?.carrier_id ?? movement?.vendor_id ?? movement?.override_payee_id ?? order.vendor_id ?? "").trim();
  const named = (value: unknown) => value && typeof value === "object"
    ? String((value as Record<string, unknown>).name ?? "").trim() : "";
  let carrierName = named(movement?.carrier) || named(movement?.vendor) || named(movement?.payee) ||
    named(order.carrier) || named(order.vendor) ||
    String(movement?.carrier_name ?? movement?.vendor_name ?? order.carrier_name ?? "").trim();
  if (!carrierName && carrierCode) {
    for (const path of ["carriers", "vendors"]) {
      try {
        const carrierResponse = await fetch(`${base}/${path}/${encodeURIComponent(carrierCode)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
        });
        if (carrierResponse.ok) carrierName = named(await carrierResponse.json());
        if (carrierName) break;
      } catch { /* The order can still be used when the carrier endpoint is unavailable. */ }
    }
  }
  const orderDate = String(stop.sched_arrive_early ?? stop.sched_arrive_late ?? order.ordered_date ?? "").trim();
  const orderStatus = String(order.__statusDescr ?? movement?.__statusDescr ?? order.status ?? "").trim();
  return { direction, reference, customer, commodity, materialType, mark, baleCount,
    destination, driverName, driverPhone, carrierName, carrierCode, orderDate, orderStatus,
    stopId: String(stop.id ?? ""), actualArrival: String(stop.actual_arrival ?? ""), actualDeparture: String(stop.actual_departure ?? "") };
}
