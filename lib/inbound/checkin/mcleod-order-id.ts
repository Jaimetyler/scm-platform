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
