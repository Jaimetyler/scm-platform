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
  const field = direction === "pickup" ? "blnum" : "consignee_refno";
  const reference = String(order[field] ?? "").trim().toUpperCase();
  const customer = String(order.customer?.name ?? order.customer_name ?? order.customer_id ?? "").trim().toUpperCase();
  if (!reference) throw new Error(`McLeod order ${orderId} has no ${field}`);
  if (!customer) throw new Error(`McLeod order ${orderId} has no customer`);
  return { orderId, field, reference, customer };
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
  return { direction, reference, customer };
}
