import { NextRequest, NextResponse } from "next/server";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { normalizeKey } from "@/lib/mcleod/inbound/utils";

export const runtime = "nodejs";

function value(input: unknown) { return String(input ?? "").trim(); }

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const mark = value(params.get("mark")).toUpperCase();
    const terminal = value(params.get("terminal")).toUpperCase();
    const siteCode = value(params.get("siteCode"));
    if (!CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode))
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    if (mark.length < 3 || mark.length > 80 || normalizeKey(mark).length < 3)
      return NextResponse.json({ ok: false, error: "Enter at least three mark characters" }, { status: 400 });
    const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw new Error("McLeod connection is not configured");
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const matches = new Map<string, { orderId: string; mark: string; customer: string; bolBC: number | null }>();
    for (const field of ["consignee_refno", "blnum"]) {
      const query = new URLSearchParams({ [`orders.${field}`]: `*${mark.replace(/\*/g, "")}*`, recordLength: "200" });
      const response = await fetch(`${base}/orders/search?${query}`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error(`McLeod search failed (${response.status})`);
      const orders = extractSearchOrders(await response.json());
      if (!orders) throw new Error("McLeod returned an unexpected search response");
      if (orders.length >= 200) throw new Error("Too many orders. Enter more of the mark.");
      for (const item of orders) {
        const order = item as Record<string, unknown>;
        const id = value(order.id);
        const ref = value(order.consignee_refno).toUpperCase();
        const blnum = value(order.blnum).toUpperCase();
        const parsed = blnum.match(/^(.+?)\s+(\d+)\s+(?:BALES?|B\/?C|BC)$/);
        if (!id || ![ref, parsed?.[1] || (!parsed ? blnum : "")]
          .some((candidate) => candidate && normalizeKey(candidate).includes(normalizeKey(mark)))) continue;
        const commodity = value((order.commodity as Record<string, unknown> | undefined)?.description || order.commodity_description || order.commodity_id).toUpperCase();
        if (commodity && !/\bCOTTON\b/.test(commodity)) continue;
        const customer = order.customer as Record<string, unknown> | undefined;
        matches.set(id, { orderId: id, mark: ref || parsed?.[1] || mark,
          customer: value(customer?.name || order.customer_name || order.customer_id).toUpperCase(),
          bolBC: parsed ? Number(parsed[2]) : null });
      }
    }
    return NextResponse.json({ ok: true, matches: [...matches.values()].slice(0, 20) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search McLeod" }, { status: 500 });
  }
}
