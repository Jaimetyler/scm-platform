import { currentCottonOrder } from "./current-cotton-order";
import { describeMcleodCompletion } from "./mcleod-order-id";
import { normalizeKey } from "@/lib/mcleod/inbound/utils";

export async function verifyCottonOrder(orderId: string, mark: string, bolBC: number | null, forNewCheckin = false) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) throw new Error("Invalid SCM order number");
  const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!base || !token) throw new Error("McLeod connection is not configured");
  const response = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Could not verify SCM order ${orderId} (${response.status})`);
  const order = await response.json();
  if (String(order.revenue_code_id ?? "").trim().toUpperCase() !== "MAIN")
    throw new Error(`SCM order ${orderId} is not in the MAIN revenue code`);
  const commodity = String(order.commodity?.description ?? order.commodity?.name ?? order.commodity_description ?? order.commodity_id ?? "").toUpperCase();
  if (!/\bCOTTON\b/.test(commodity)) throw new Error(`SCM order ${orderId} is not a cotton order`);
  const blnum = String(order.blnum ?? "").trim().toUpperCase();
  const parsed = blnum.match(/^(.+?)\s+(\d+)\s+(?:BALES?|B\/?C|BC)$/);
  const references = [String(order.consignee_refno ?? ""), parsed?.[1] ?? ""];
  if (!normalizeKey(mark) || !references.some((reference) => normalizeKey(reference) === normalizeKey(mark)))
    throw new Error(`SCM order ${orderId} does not have this exact cotton mark`);
  if (bolBC && parsed && bolBC > Number(parsed[2]))
    throw new Error(`SCM order ${orderId} has a different BOL bale count`);
  const deliveryStop = (Array.isArray(order.stops) ? order.stops : [])
    .find((stop: { stop_type?: string }) => stop.stop_type === "SO");
  const completion = await describeMcleodCompletion(order, deliveryStop, "delivery");
  if (completion) throw new Error(completion.message);
  const eligibility = currentCottonOrder(order);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  if (forNewCheckin) {
    const delivery = (Array.isArray(order.stops) ? order.stops : [])
      .find((stop: { stop_type?: string }) => stop.stop_type === "SO");
    if (String(delivery?.actual_departure ?? "").trim())
      throw new Error(`SCM order ${orderId} has already been delivered in McLeod.`);
  }
  return parsed ? Number(parsed[2]) : null;
}
