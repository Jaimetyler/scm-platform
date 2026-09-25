import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractSearchOrders } from "@/lib/mcleod/inbound/search-response";

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
    const id = text(new URL(req.url).searchParams.get("id"));
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid check-in" }, { status: 400 });
    }
    const { data: row, error } = await database().from("inbound_checkin_rows")
      .select("id,checkin_source,material_type,movement_direction,reference_number")
      .eq("id", id).single();
    if (error || !row || !["lumber", "other"].includes(row.material_type)) {
      return NextResponse.json({ ok: false, error: "Check-in not found" }, { status: 404 });
    }
    const reference = text(row.reference_number).toUpperCase();
    if (reference.length < 3 || !["pickup", "delivery"].includes(row.movement_direction)) {
      return NextResponse.json({ ok: false, error: "Reference or direction is missing" }, { status: 400 });
    }
    const field = row.movement_direction === "pickup" ? "blnum" : "consignee_refno";
    const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
    const token = process.env.MCLEOD_AUTH_TOKEN;
    if (!base || !token) throw new Error("McLeod connection is not configured");
    // McLeod accepts * wildcards. Search one field only, then verify the
    // returned field contains the submitted number before showing candidates.
    const params = new URLSearchParams({ [`orders.${field}`]: `*${reference.replace(/\*/g, "")}*`, recordLength: "200" });
    const response = await fetch(`${base}/orders/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
    });
    if (!response.ok) throw new Error(`McLeod search failed (${response.status})`);
    const payload: unknown = await response.json();
    const results = extractSearchOrders(payload);
    if (!results) throw new Error("McLeod returned an unexpected search response");
    if (results.length >= 200) throw new Error("Too many possible orders. Use a longer reference number.");
    const matches = new Map<string, { orderId: string; customerId: string; customerName: string; value: string }>();
    for (const item of results) {
      const order = item as Record<string, unknown>;
      const value = text(order[field]);
      const orderId = text(order.id);
      if (!orderId || !value.toUpperCase().includes(reference)) continue;
      const customer = order.customer as Record<string, unknown> | undefined;
      matches.set(orderId, {
        orderId, value, customerId: text(order.customer_id),
        customerName: text(customer?.name || order.customer_name || order.customer_id),
      });
    }
    return NextResponse.json({ ok: true, field, reference, matches: [...matches.values()] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not search McLeod" }, { status: 500 });
  }
}
