import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
export const runtime = "nodejs";
function user(req: NextRequest) { return staffActor(req); }
async function POSTHandler(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    const targetBookingNumber = String(body?.targetBookingNumber ?? "").trim().toUpperCase();
    const moves = Array.isArray(body?.moves) ? body.moves.map((move: Record<string, unknown>) => ({
      lineId: String(move?.lineId ?? ""), bales: Number(move?.bales),
    })) : [];
    if (!/^[0-9a-f-]{36}$/i.test(id) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    if (!/^[A-Z0-9_/-]{3,40}$/.test(targetBookingNumber) || moves.length < 1 || moves.length > 200 ||
        moves.some((move) => !/^[0-9a-f-]{36}$/i.test(move.lineId) || !Number.isSafeInteger(move.bales) || move.bales < 1))
      return NextResponse.json({ ok: false, error: "Choose marks, valid bale counts, and a destination booking" }, { status: 400 });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    const sb = createClient(url, key);
    const { data: booking, error: bookingError } = await sb.from("cotton_outbound_bookings").select("id")
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found at this warehouse" }, { status: 404 });
    const { data, error } = await sb.rpc("bulk_roll_cotton_outbound_booking_lines", {
      p_source_booking_id: id, p_moves: moves, p_target_booking_number: targetBookingNumber, p_changed_by: user(req),
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    return NextResponse.json({ ok: true, targetBookingId: data, targetBookingNumber });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not roll selected marks" }, { status: 500 });
  }
}

export const POST = withStaffAccess(POSTHandler);
