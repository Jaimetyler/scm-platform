import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase configuration");
  return createClient(url, key);
}

function text(value: unknown) { return String(value ?? "").trim(); }

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const id = text(params.get("id"));
    let direction = text(params.get("movementDirection"));
    let reference = text(params.get("referenceNumber")).toUpperCase();
    if (id) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid check-in" }, { status: 400 });
      const { data: row, error } = await database().from("inbound_checkin_rows")
        .select("id,material_type,movement_direction,reference_number").eq("id", id).single();
      if (error || !row || !["lumber", "other"].includes(row.material_type)) {
        return NextResponse.json({ ok: false, error: "Check-in not found" }, { status: 404 });
      }
      direction = row.movement_direction;
      reference = text(row.reference_number).toUpperCase();
    } else if (!CHECKIN_SITES.some((site) => site.terminal === text(params.get("terminal")).toUpperCase() && site.siteCode === text(params.get("siteCode")))) {
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    }
    if (reference.length < 3 || reference.length > 200 || !["pickup", "delivery"].includes(direction)) {
      return NextResponse.json({ ok: false, error: "Reference or direction is missing" }, { status: 400 });
    }
    const field = direction === "pickup" ? "blnum" : "consignee_refno";
    const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw new Error("McLeod connection is not configured");
    async function search(searchField: string) {
      const searchParams = new URLSearchParams({ [`orders.${searchField}`]: `*${reference.replace(/\*/g, "")}*`, recordLength: "200" });
      const response = await fetch(`${base}/orders/search?${searchParams}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
      });
      if (!response.ok) throw new Error(`McLeod search failed (${response.status})`);
      const results = extractSearchOrders(await response.json());
      if (!results) throw new Error("McLeod returned an unexpected search response");
      if (results.length >= 200) throw new Error("Too many possible orders. Use a longer reference number.");
      return results;
    }
    const fields = !id && params.get("strictDirection") !== "1"
      ? [field, field === "blnum" ? "consignee_refno" : "blnum"] : [field];
    const resultSets = await Promise.all(fields.map(async (searchField) => ({ field: searchField, results: await search(searchField) })));
    const matches = new Map<string, { orderId: string; customerId: string; customerName: string; value: string;
      materialType: "lumber" | "other" | null; destination: string; direction: string }>();
    for (const set of resultSets) for (const item of set.results) {
      const order = item as Record<string, unknown>;
      const value = text(order[set.field]);
      const orderId = text(order.id);
      if (!orderId || !value.toUpperCase().includes(reference)) continue;
      const matchDirection = set.field === "blnum" ? "pickup" : "delivery";
      const customer = order.customer as Record<string, unknown> | undefined;
      const commodity = text((order.commodity as Record<string, unknown> | undefined)?.description || order.commodity_description || order.commodity_id).toUpperCase();
      const stops = Array.isArray(order.stops) ? order.stops as Record<string, unknown>[] : [];
      const delivery = stops.find((stop) => stop.stop_type === "SO");
      const location = delivery?.location as Record<string, unknown> | undefined;
      matches.set(`${orderId}:${matchDirection}`, {
        orderId, value, direction: matchDirection, customerId: text(order.customer_id),
        customerName: text(customer?.name || order.customer_name || order.customer_id),
        materialType: /\bLUMBER\b|\bWOOD\b/.test(commodity) ? "lumber" : /\bOTHER\b|\bFAK\b/.test(commodity) ? "other" : null,
        destination: text(location?.name || delivery?.location_name),
      });
    }
    if (matches.size === 1) {
      const match = [...matches.values()][0];
      const matchedField = match.direction === "pickup" ? "blnum" : "consignee_refno";
      const full = await fetch(`${base}/orders/${encodeURIComponent(match.orderId)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
      });
      if (!full.ok) throw new Error(`Could not verify McLeod order (${full.status})`);
      const order = await full.json();
      if (!text(order[matchedField]).toUpperCase().includes(reference)) {
        return NextResponse.json({ ok: false, error: "McLeod order changed during lookup. Try the reference again." }, { status: 409 });
      }
      const customer = order.customer as Record<string, unknown> | undefined;
      const commodity = text(order.commodity?.description || order.commodity_description || order.commodity_id).toUpperCase();
      if (/\bCOTTON\b/.test(commodity)) return NextResponse.json({ ok: false, error: "This is a cotton order. Use the Cotton grid." }, { status: 409 });
      const delivery = (Array.isArray(order.stops) ? order.stops : []).find((stop: Record<string, unknown>) => stop.stop_type === "SO");
      match.customerName = text(customer?.name || order.customer_name || order.customer_id) || match.customerName;
      match.materialType = /\bLUMBER\b|\bWOOD\b/.test(commodity) ? "lumber" : /\bOTHER\b|\bFAK\b/.test(commodity) ? "other" : match.materialType;
      match.destination = text(delivery?.location?.name || delivery?.location_name) || match.destination;
    }
    return NextResponse.json({ ok: true, reference, matches: [...matches.values()] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search McLeod" }, { status: 500 });
  }
}
