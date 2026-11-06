import { searchReferenceOrders } from "../inbound/checkin/reference-search.ts";
import { normalizeReference } from "../inbound/checkin/reference-match.ts";
import { mcleodOrderStops, stopAtScmYard } from "../inbound/checkin/yard-stop.ts";
import type { CheckinSite } from "../inbound/checkin/sites.ts";

const revenueCode = "DDRAY";
const amount = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number" || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const matchesMark = (reference: unknown, mark: string) =>
  normalizeReference(reference).replace(/\s+\d+\s+(?:BALES?|B\/?C)$/i, "") === mark;

export async function readBookingMarkCharges(
  read: (path: string) => Promise<unknown>, site: CheckinSite, mark: string, signal: AbortSignal,
) {
  const key = normalizeReference(mark);
  const candidates = await Promise.all((["blnum", "consignee_refno"] as const).map(field =>
    searchReferenceOrders(read, field, key, signal, revenueCode)));
  const ids = new Set(candidates.flat().map(row => String(row.id)));
  const orders = [];
  for (const id of ids) {
    signal.throwIfAborted();
    const order = await read(`/orders/${encodeURIComponent(id)}`) as Record<string, any> | null;
    if (!order || String(order.id) !== id || !order.customer_id) throw Error("McLeod order identity could not be verified.");
    if (String(order.revenue_code_id ?? "").trim().toUpperCase() !== revenueCode ||
        String(order.customer_id).trim().toUpperCase() !== "BUNGOMNE" ||
        /^(?:V|VOID|VOIDED|CANCELLED|CANCELED)$/i.test(String(order.__statusDescr || order.status || "").trim()) ||
        ![order.blnum, order.consignee_refno].some(reference => matchesMark(reference, key))) continue;
    if (!mcleodOrderStops(order).some(stop => stopAtScmYard(stop, site.siteName, site.terminal))) continue;
    const lines = order.otherCharges ?? order.other_charges ?? order.otherCharge;
    orders.push({
      id, revenueCode: String(order.revenue_code_id ?? ""), status: String(order.__statusDescr ?? order.status ?? ""),
      rate: amount(order.rate), rateUnits: amount(order.rate_units), total: amount(order.total_charge),
      charges: Array.isArray(lines) ? lines.map(line => ({
        code: String(line.charge_id ?? ""), description: String(line.descr ?? line.description ?? ""),
        units: amount(line.units), rate: amount(line.rate), amount: amount(line.amount),
      })) : null,
    });
  }
  return orders;
}
