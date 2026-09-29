import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
export const runtime = "nodejs";
function user(req: NextRequest) {
  try { return atob(req.headers.get("authorization")?.slice(6) ?? "").split(":")[0] || "warehouse user"; }
  catch { return "warehouse user"; }
}
export async function POST(req: NextRequest, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    const { id, lineId } = await context.params;
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    const targetBookingNumber = String(body?.targetBookingNumber ?? "").trim().toUpperCase();
    const bales = Number(body?.bales);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(lineId) ||
        !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    if (!/^[A-Z0-9_/-]{3,40}$/.test(targetBookingNumber) || !Number.isSafeInteger(bales) || bales < 1)
      return NextResponse.json({ ok: false, error: "Enter a valid destination booking and bale count" }, { status: 400 });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    const sb = createClient(url, key);
    const { data: source, error: sourceError } = await sb.from("cotton_outbound_booking_lines")
      .select("id,booking_id").eq("id", lineId).eq("booking_id", id).maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return NextResponse.json({ ok: false, error: "Booking mark not found" }, { status: 404 });
    const { data, error } = await sb.rpc("roll_cotton_outbound_booking_line", {
      p_source_line_id: lineId, p_bales: bales, p_target_booking_number: targetBookingNumber, p_changed_by: user(req),
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    return NextResponse.json({ ok: true, targetBookingId: data, targetBookingNumber });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not roll booking mark" }, { status: 500 });
  }
}
