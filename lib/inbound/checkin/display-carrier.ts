import { createHash } from "node:crypto";

export type DisplayCarrier = { carrierName: string | null; carrierCode: string | null; scmCarrier: boolean };
const empty: DisplayCarrier = { carrierName: null, carrierCode: null, scmCarrier: false };
// Display-only data. Never use this cache to authorize processing, checkout or edits.
const cache = new Map<string, { expires: number; value: Promise<DisplayCarrier> }>();
const MAX_ENTRIES = 256;
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
let enrichmentCursor = 0;

export function lookupDisplayCarrier(orderId: string): Promise<DisplayCarrier> {
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  const configured = process.env.SCM_CARRIER_CODES ?? "";
  if (!base || !token || !/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) return Promise.resolve(empty);
  const scope = createHash("sha256").update(`${base}\0${token}\0${configured}`).digest("hex");
  const key = `${scope}:${orderId}`;
  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  const cached = cache.get(key);
  if (cached) return cached.value;
  // Do not create an unbounded upstream work queue during an outage or burst.
  if (inFlight >= MAX_IN_FLIGHT) return Promise.resolve(empty);
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  inFlight += 1;
  const signal = AbortSignal.timeout(2_000);
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const value = (async () => {
    const response = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, { headers, cache: "no-store", signal });
    if (!response.ok) throw new Error("Display carrier lookup unavailable");
    const order = await response.json();
    const movements: Record<string, any>[] = Array.isArray(order.movements) ? order.movements : [];
    const movement = movements.find((item) => String(item.id ?? "") === String(order.curr_movement_id ?? "")) ?? movements[0];
    const carrierCode = String(movement?.carrier_id ?? movement?.vendor_id ?? movement?.override_payee_id ?? order.vendor_id ?? "").trim().toUpperCase() || null;
    const named = (item: any) => item && typeof item === "object" ? String(item.name ?? "").trim() : "";
    let carrierName = named(movement?.carrier) || named(movement?.vendor) || named(movement?.payee) || named(order.carrier) || named(order.vendor) ||
      String(movement?.carrier_name ?? movement?.vendor_name ?? order.carrier_name ?? "").trim() || null;
    if (!carrierName && carrierCode) {
      for (const path of ["carriers", "vendors"]) {
        const carrier = await fetch(`${base}/${path}/${encodeURIComponent(carrierCode)}`, { headers, cache: "no-store", signal });
        if (carrier.ok) carrierName = named(await carrier.json()) || null;
        if (carrierName) break;
      }
    }
    const codes = new Set(["SCMIRIGA", ...configured.split(",").map((code) => code.trim().toUpperCase())]);
    if (!carrierName && !carrierCode) {
      const entry = cache.get(key);
      if (entry?.value === value) entry.expires = Date.now() + 30_000;
    }
    return { carrierName, carrierCode, scmCarrier: Boolean(carrierCode && codes.has(carrierCode)) };
  })().catch(() => {
    const entry = cache.get(key);
    if (entry?.value === value) entry.expires = Date.now() + 30_000;
    return empty;
  }).finally(() => { inFlight -= 1; });
  cache.set(key, { expires: now + 5 * 60_000, value });
  return value;
}

export async function enrichDisplayCarriers<T extends { matched_order_id?: string | null; trucking_company?: string | null }>(rows: T[], includeCodes = false) {
  const ids = [...new Set(rows.filter((row) => row.matched_order_id && (includeCodes || !row.trucking_company)).map((row) => row.matched_order_id!))];
  const carriers = new Map<string, DisplayCarrier>();
  // Rotate admission so repeated failures at the head of a busy page cannot
  // permanently starve optional enrichment for later rows.
  const start = ids.length ? enrichmentCursor % ids.length : 0;
  const orderedIds = [...ids.slice(start), ...ids.slice(0, start)];
  enrichmentCursor = start + MAX_IN_FLIGHT;
  // Enrichment cannot hold the operational queue behind a slow McLeod service.
  // Remaining bounded lookups finish in the background and populate the next poll.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(orderedIds.map(async (id) => { carriers.set(id, await lookupDisplayCarrier(id)); })),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, 150); }),
  ]);
  if (timer) clearTimeout(timer);
  return rows.map((row) => {
    const carrier = carriers.get(row.matched_order_id ?? "");
    return { ...row, trucking_company: row.trucking_company || carrier?.carrierName || null,
      ...(includeCodes && row.matched_order_id ? { carrier_code: carrier?.carrierCode ?? null, scm_carrier: carrier?.scmCarrier ?? false } : {}) };
  });
}
