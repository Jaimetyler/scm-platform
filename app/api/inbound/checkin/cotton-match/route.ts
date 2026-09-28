import { NextRequest, NextResponse } from "next/server";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { normalizeKey } from "@/lib/mcleod/inbound/utils";
import { CUSTOMER_XREF } from "@/lib/mcleod/inbound/xref";

export const runtime = "nodejs";

function value(input: unknown) { return String(input ?? "").trim(); }
function orderDay(input: unknown) {
  const raw = value(input);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  const day = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Date.parse(raw);
  return Number.isFinite(day) ? day : null;
}
function named(input: unknown) {
  return input && typeof input === "object" ? value((input as Record<string, unknown>).name) : "";
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const mark = value(params.get("mark")).toUpperCase();
    const terminal = value(params.get("terminal")).toUpperCase();
    const siteCode = value(params.get("siteCode"));
    const shipper = value(params.get("customer")).toUpperCase();
    const customerId = CUSTOMER_XREF.find((row) => row.active &&
      [row.alias, row.canonicalCustomer, row.customerName, row.customerId]
        .some((candidate) => normalizeKey(candidate) === normalizeKey(shipper)))?.customerId;
    if (!CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode))
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    if (mark.length < 3 || mark.length > 80 || normalizeKey(mark).length < 3)
      return NextResponse.json({ ok: false, error: "Enter at least three mark characters" }, { status: 400 });
    const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw new Error("McLeod connection is not configured");
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const matches = new Map<string, { orderId: string; mark: string; customer: string; bolBC: number | null;
      carrierName: string; carrierCode: string; orderDate: string; orderStatus: string;
      driverName: string; driverPhone: string }>();
    const failedFields: string[] = [];
    let missingRevenueCode = false;
    for (const field of ["consignee_refno", "blnum"]) {
      const query = new URLSearchParams({ [`orders.${field}`]: `*${mark.replace(/\*/g, "")}*`, recordLength: "200" });
      if (customerId) query.set("customer.id", customerId);
      let orders: unknown[] | null;
      try {
        const response = await fetch(`${base}/orders/search?${query}`, { headers, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        orders = extractSearchOrders(await response.json());
        if (!orders) throw new Error("unexpected response");
        if (orders.length >= 200) throw new Error("result limit reached");
      } catch (error) {
        failedFields.push(`${field}: ${error instanceof Error ? error.message : "request failed"}`);
        continue;
      }
      for (const item of orders) {
        const order = item as Record<string, unknown>;
        const id = value(order.id);
        const ref = value(order.consignee_refno).toUpperCase();
        const blnum = value(order.blnum).toUpperCase();
        const parsed = blnum.match(/^(.+?)\s+(\d+)\s+(?:BALES?|B\/?C|BC)$/);
        if (!id || ![ref, parsed?.[1] || (!parsed ? blnum : "")]
          .some((candidate) => candidate && normalizeKey(candidate).includes(normalizeKey(mark)))) continue;
        const revenueCode = value(order.revenue_code_id).toUpperCase();
        if (!revenueCode) missingRevenueCode = true;
        if (revenueCode !== "MAIN") continue;
        const commodity = value((order.commodity as Record<string, unknown> | undefined)?.description || order.commodity_description || order.commodity_id).toUpperCase();
        if (!/\bCOTTON\b/.test(commodity)) continue;
        const customer = order.customer as Record<string, unknown> | undefined;
        const parsedMark = parsed?.[1] || "";
        matches.set(id, { orderId: id,
          mark: parsedMark && normalizeKey(parsedMark).includes(normalizeKey(mark)) ? parsedMark : ref || parsedMark || mark,
          customer: value(customer?.name || order.customer_name || order.customer_id).toUpperCase(),
          bolBC: parsed ? Number(parsed[2]) : null, carrierName: "", carrierCode: "", orderDate: "", orderStatus: "",
          driverName: "", driverPhone: "" });
      }
    }
    if (failedFields.length === 2) throw new Error(`McLeod could not search this mark (${failedFields.join("; ")}). Try a longer mark or enter the customer and BOL count manually.`);
    if (matches.size > 20) throw new Error("Too many matching orders. Enter a longer mark.");
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    const verified = await Promise.all([...matches.values()].map(async (match) => {
      const response = await fetch(`${base}/orders/${encodeURIComponent(match.orderId)}`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error(`Could not verify McLeod order (${response.status})`);
      const order = await response.json() as Record<string, unknown>;
      if (value(order.revenue_code_id).toUpperCase() !== "MAIN") return null;
      const stops = Array.isArray(order.stops) ? order.stops as Record<string, unknown>[] : [];
      const delivery = stops.find((stop) => stop.stop_type === "SO");
      if (value(delivery?.actual_departure)) return null;
      const scheduled = value(delivery?.sched_arrive_early || delivery?.sched_arrive_late || order.ordered_date);
      if (scheduled && (orderDay(scheduled) ?? Date.now()) < cutoff) return null;
      const movements = Array.isArray(order.movements) ? order.movements as Record<string, unknown>[] : [];
      const movement = movements.find((item) => value(item.id) === value(order.curr_movement_id)) ?? movements[0];
      match.orderDate = scheduled;
      match.orderStatus = value(order.__statusDescr || movement?.__statusDescr || order.status);
      match.carrierCode = value(movement?.carrier_id || movement?.vendor_id || movement?.override_payee_id || order.vendor_id);
      match.carrierName = named(movement?.carrier) || named(movement?.vendor) || named(movement?.payee) ||
        named(order.carrier) || named(order.vendor) || value(movement?.carrier_name || movement?.vendor_name || order.carrier_name);
      match.driverName = value(movement?.override_driver_nm);
      match.driverPhone = value(movement?.override_drvr_cell);
      if (!match.carrierName && match.carrierCode) {
        for (const path of ["carriers", "vendors"]) {
          try {
            const carrier = await fetch(`${base}/${path}/${encodeURIComponent(match.carrierCode)}`, { headers, cache: "no-store" });
            if (carrier.ok) match.carrierName = named(await carrier.json());
            if (match.carrierName) break;
          } catch { /* Keep the verified order and show its carrier code. */ }
        }
      }
      return match;
    }));
    return NextResponse.json({ ok: true, matches: verified.filter((match) => match !== null),
      incomplete: failedFields.length > 0 || missingRevenueCode,
      warning: failedFields.length ? `McLeod search incomplete (${failedFields.join("; ")})` :
        missingRevenueCode ? "McLeod omitted a revenue code; verify the order manually" : "" },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search McLeod" }, { status: 500 });
  }
}
