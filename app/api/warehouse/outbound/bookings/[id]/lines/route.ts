import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { normalizeBookingMark } from "@/lib/warehouse/outbound/marks";

export const runtime = "nodejs";
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const terminal = String(body.terminal ?? "").toUpperCase();
    const siteCode = String(body.siteCode ?? "");
    const requestId = String(body.requestId ?? "");
    const expectedUpdatedAt = String(body.expectedUpdatedAt ?? "");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id) || !uuid.test(requestId) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) return NextResponse.json({ ok: false, error: "Reload before adding a mark" }, { status: 409 });
    let values;
    try { values = normalizeBookingMark(body); }
    catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    let actor = "warehouse user";
    try { actor = atob(req.headers.get("authorization")?.slice(6) ?? "").split(":")[0] || actor; } catch { /* Use the staff fallback. */ }
    const { data, error } = await createClient(url, key).rpc("add_cotton_outbound_booking_mark", {
      p_booking_id: id, p_terminal: terminal, p_site_code: siteCode, p_expected_updated_at: expectedUpdatedAt,
      p_request_id: requestId, p_mark: values.mark, p_bales: values.bales, p_shipping_order: values.shippingOrder, p_changed_by: actor,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: /changed|already|request was/.test(error.message) ? 409 : /not found/.test(error.message) ? 404 : 400 });
    return NextResponse.json({ ok: true, lineId: data });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not add mark" }, { status: 500 }); }
}
