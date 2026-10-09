import { DependencyError, dependencyFetch } from "@/lib/http/dependency";
import { mapLimit } from "@/lib/http/map-limit";
import { YardStopError } from "@/lib/inbound/checkin/yard-stop";
import { withStaffAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { lookupMcleodGateOrder, type McleodCompletion } from "@/lib/inbound/checkin/mcleod-order-id";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase configuration");
  return createClient(url, key);
}

function text(value: unknown) { return String(value ?? "").trim(); }
function orderDay(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  const day = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Date.parse(raw);
  return Number.isFinite(day) ? day : null;
}
function named(value: unknown) {
  return value && typeof value === "object" ? text((value as Record<string, unknown>).name) : "";
}

async function GETHandler(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const id = text(params.get("id"));
    let direction = text(params.get("movementDirection"));
    let terminal = text(params.get("terminal")).toUpperCase();
    let siteCode = text(params.get("siteCode"));
    let reference = text(params.get("referenceNumber")).toUpperCase();
    if (id) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid check-in" }, { status: 400 });
      const { data: row, error } = await database().from("inbound_checkin_rows")
        .select("id,terminal,site_code,material_type,movement_direction,reference_number").eq("id", id).single();
      if (error) throw new DependencyError("Could not load this arrival. Please try again.");
      if (!row || !["lumber", "other"].includes(row.material_type)) {
        return NextResponse.json({ ok: false, error: "Check-in not found" }, { status: 404 });
      }
      terminal = row.terminal;
      siteCode = row.site_code;
      direction = row.movement_direction;
      reference = text(row.reference_number).toUpperCase();
    }
    const configuredSite = CHECKIN_SITES.find((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("lumber"));
    if (!configuredSite) {
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
      const response = await dependencyFetch(`${base}/orders/search?${searchParams}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
      });
      if (!response.ok) throw new DependencyError(`McLeod search failed (${response.status}). Please try again.`);
      const results = extractSearchOrders(await response.json());
      if (!results) throw new Error("McLeod returned an unexpected search response");
      if (results.length >= 200) throw new Error("Too many possible orders. Use a longer reference number.");
      return results;
    }
    const fields = !id && params.get("strictDirection") !== "1"
      ? [field, field === "blnum" ? "consignee_refno" : "blnum"] : [field];
    const resultSets = await Promise.all(fields.map(async (searchField) => ({ field: searchField, results: await search(searchField) })));
    const matches = new Map<string, { orderId: string; customerId: string; customerName: string; value: string;
      materialType: "lumber" | "other" | null; destination: string; direction: string;
      carrierName: string; carrierCode: string; orderDate: string; orderStatus: string;
      driverName: string; driverPhone: string; stopId?: string; movementId?: string; completion?: McleodCompletion | null }>();
    for (const set of resultSets) for (const item of set.results) {
      const order = item as Record<string, unknown>;
      const value = text(order[set.field]);
      const orderId = text(order.id);
      if (!orderId || !value) throw new DependencyError("McLeod returned incomplete order identity or reference details. Please try again.");
      if (!value.toUpperCase().includes(reference)) continue;
      if (!text(order.revenue_code_id)) throw new DependencyError("McLeod search omitted the revenue code. Cannot verify this order.");
      if (text(order.revenue_code_id).toUpperCase() !== "MAIN") continue;
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
        carrierName: "", carrierCode: "", orderDate: "", orderStatus: "", driverName: "", driverPhone: "",
      });
    }
    if (matches.size > 20) throw new Error("Too many matching orders. Enter a longer reference number.");
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    const orderRequests = new Map<string, Promise<Record<string, any>>>();
    async function fullOrder(orderId: string) {
      if (!orderRequests.has(orderId)) orderRequests.set(orderId, (async () => {
        const response = await dependencyFetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
        });
        if (!response.ok) throw new DependencyError("McLeod order verification is temporarily unavailable.");
        return response.json();
      })());
      return orderRequests.get(orderId)!;
    }
    const verified = await mapLimit([...matches.values()], 4, async (match) => {
      const matchedField = match.direction === "pickup" ? "blnum" : "consignee_refno";
      const order = await fullOrder(match.orderId);
      let yardOrder;
      try { yardOrder = await lookupMcleodGateOrder(match.orderId, configuredSite.terminal, configuredSite.siteName, match.direction as "pickup" | "delivery", undefined, order); }
      catch (error) { if (error instanceof YardStopError && error.code === "YARD_STOP_NOT_FOUND") return null; throw error; }
      match.stopId = yardOrder.stopId; match.movementId = yardOrder.movementId;
      if (yardOrder.direction !== match.direction) return null;
      match.completion = yardOrder.completion;
      if (text(order.revenue_code_id).toUpperCase() !== "MAIN" ||
          !text(order[matchedField]).toUpperCase().includes(reference)) return null;
      const customer = order.customer as Record<string, unknown> | undefined;
      const commodity = order.commodity as Record<string, unknown> | string | undefined;
      const commodityName = text((typeof commodity === "object" ? commodity?.description : commodity) || order.commodity_description || order.commodity_id).toUpperCase();
      if (/\bCOTTON\b/.test(commodityName)) return null;
      const scheduled = yardOrder.orderDate;
      if (!match.completion && scheduled && (orderDay(scheduled) ?? Date.now()) < cutoff) return null;
      match.customerName = yardOrder.customer || match.customerName;
      match.materialType = yardOrder.materialType === "cotton" ? null : yardOrder.materialType || match.materialType;
      match.destination = yardOrder.destination;
      match.orderDate = scheduled; match.orderStatus = yardOrder.orderStatus;
      match.carrierName = match.completion?.carrierName || yardOrder.carrierName;
      match.carrierCode = match.completion?.carrierCode || yardOrder.carrierCode;
      match.driverName = yardOrder.driverName; match.driverPhone = yardOrder.driverPhone;
      return match;
    });
    return NextResponse.json({ ok: true, reference, matches: verified.filter((match) => match !== null) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search McLeod" }, { status: error instanceof DependencyError ? 503 : error instanceof YardStopError ? 409 : 500 });
  }
}

export const GET = withStaffAccess(GETHandler);
