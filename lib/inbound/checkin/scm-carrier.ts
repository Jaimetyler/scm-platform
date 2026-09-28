type Carrier = { carrierCode: string | null; scmCarrier: boolean };
const cache = new Map<string, { expires: number; value: Promise<Carrier> }>();

export function classifyScmCarrier(order: Record<string, unknown>, configured = process.env.SCM_CARRIER_CODES) {
  const movements = Array.isArray(order.movements) ? order.movements as Record<string, unknown>[] : [];
  const movement = movements.find((item) => String(item.id ?? "") === String(order.curr_movement_id ?? "")) ?? movements[0];
  const code = String(movement?.carrier_id ?? movement?.vendor_id ?? order.vendor_id ?? "").trim().toUpperCase();
  const scmCodes = new Set(["SCMIRIGA", ...(configured ?? "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)]);
  return { carrierCode: code || null, scmCarrier: Boolean(code && scmCodes.has(code)) };
}

export function lookupScmCarrier(orderId: string): Promise<Carrier> {
  const cached = cache.get(orderId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = (async () => {
    const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw new Error("McLeod connection is not configured");
    const response = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`McLeod carrier lookup failed (${response.status})`);
    return classifyScmCarrier(await response.json());
  })();
  cache.set(orderId, { expires: Date.now() + 5 * 60_000, value });
  value.catch(() => { if (cache.get(orderId)?.value === value) cache.delete(orderId); });
  return value;
}
