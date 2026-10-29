export const DALLAS_ECOTTON_LOCATIONS = ["SCMDDETX", "SCMDDATX"] as const;
const key = (v: unknown) => String(v ?? "").trim().toUpperCase();
export function validateDallasLocation(value: unknown): string {
  const location = key(value);
  if (!(DALLAS_ECOTTON_LOCATIONS as readonly string[]).includes(location))
    throw new Error("Select the Dallas warehouse: SCMDDETX or SCMDDATX.");
  return location;
}
export function isDallasBillingOrder(order: any, reference: string, location: string): boolean {
  const stops = order?.stops;
  if (key(order?.blnum) !== key(reference) || key(order?.order_type_id) !== "ECOTTON" ||
      key(order?.revenue_code_id) !== "DLOCA" || !Array.isArray(stops) || stops.length !== 2) return false;
  return stops.filter(s => key(s.stop_type) === "PU").length === 1 &&
    stops.filter(s => key(s.stop_type) === "SO").length === 1 &&
    stops.every(s => key(s.location_id) === location);
}
/** Read only; fail closed on incomplete pages, unknown response shapes or hydration errors. */
export async function findDallasBillingOrders(read: (path: string) => Promise<any>, reference: string, warehouse: unknown): Promise<any[]> {
  const location = validateDallasLocation(warehouse);
  if (!reference.trim() || /[\u0000-\u001f*?]/.test(reference)) throw new Error("Invalid billing reference.");
  const seen = new Set<string>();
  const matches = new Map<string, any>();
  for (let offset = 0; offset < 100; offset += 5) {
    // Qualified order fields and pagination follow the existing advanced-search contract.
    // Location is checked on hydrated stops; no undocumented stop-query syntax is assumed.
    const query = new URLSearchParams({"orders.blnum": reference.trim(), "orders.order_type_id": "ECOTTON",
      "orders.revenue_code_id": "DLOCA", recordLength: "5", recordOffset: String(offset)});
    const response = await read(`/orders/search?${query}`);
    const rows = Array.isArray(response) ? response : response?.rows ?? response?.data ?? response?.items;
    if (!Array.isArray(rows) || rows.length > 5) throw new Error("McLeod billing search returned an unrecognized or incomplete response.");
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw new Error("McLeod billing search returned an invalid order ID.");
      if (seen.has(id)) continue;
      seen.add(id);
      const order = await read(`/orders/${encodeURIComponent(id)}`);
      if (String(order?.id ?? "").trim() !== id) throw new Error("McLeod billing order could not be verified.");
      if (isDallasBillingOrder(order, reference, location)) matches.set(id, order);
    }
    if (rows.length < 5) return [...matches.values()];
  }
  throw new Error("McLeod billing search incomplete; narrow the reference before applying charges.");
}
