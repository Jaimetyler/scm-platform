import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { parseBungeBooking, classifyBookingLoads } from "@/lib/warehouse/outbound/bunge";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";

export const runtime = "nodejs";
function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}
export async function GET(req: NextRequest) {
  try {
    const terminal = String(new URL(req.url).searchParams.get("terminal") ?? "").toUpperCase();
    const siteCode = String(new URL(req.url).searchParams.get("siteCode") ?? "");
    const allWarehouses = !terminal && !siteCode;
    if (!allWarehouses && !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown cotton warehouse" }, { status: 400 });
    let query = database().from("cotton_outbound_booking_dashboard").select("*");
    query = allWarehouses ? query.or(CHECKIN_SITES.filter((site) => site.materials.includes("cotton"))
      .map((site) => `and(terminal.eq.${site.terminal},site_code.eq.${site.siteCode})`).join(",")) : query.eq("terminal", terminal).eq("site_code", siteCode);
    const { data, error } = await query.order("cutoff", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    return NextResponse.json({ ok: true, bookings: data ?? [], limitReached: data?.length === 1000 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load bookings" }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const terminal = String(form.get("terminal") ?? "").toUpperCase();
    const siteCode = String(form.get("siteCode") ?? "");
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode && item.materials.includes("cotton"));
    if (!site) return NextResponse.json({ ok: false, error: "Unknown cotton warehouse" }, { status: 400 });
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || !/\.xlsx$/i.test(file.name))
      return NextResponse.json({ ok: false, error: "Choose a Bunge .xlsx file under 4 MB." }, { status: 400 });
    const booking = parseBungeBooking(Buffer.from(await file.arrayBuffer()));
    booking.lines = classifyBookingLoads(booking, terminal, siteCode);
    if (form.get("datesConfirmed") !== "true") return NextResponse.json({ ok: false,
      error: "Review and confirm the sailing dates before importing." }, { status: 400 });
    const sailing = normalizeBookingDetails({ erd: String(form.get("erd") ?? ""), docCutoff: String(form.get("docCutoff") ?? ""),
      cutoff: String(form.get("cutoff") ?? ""), vessel: String(form.get("vessel") ?? "") });
    if (booking.warnings.length) return NextResponse.json({ ok: false,
      error: booking.warnings.join(" ") + " Correct the source sheet before importing." }, { status: 409 });
    const { data, error } = await database().rpc("create_cotton_outbound_booking_draft_with_details", {
      p_terminal: terminal, p_site_code: siteCode, p_site_name: site.siteName,
      p_customer: booking.customer, p_booking_number: booking.bookingNumber,
      p_customer_reference: booking.customerReference, p_containers: booking.containers,
      p_total_bales: booking.totalBales, p_source_filename: file.name.slice(0, 200), p_lines: booking.lines,
      p_details: sailing,
    });
    if (error) return NextResponse.json({ ok: false,
      error: error.code === "23505" ? "This booking already exists at this warehouse." : error.message }, { status: error.code === "23505" ? 409 : 400 });
    return NextResponse.json({ ok: true, id: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save booking" }, { status: 400 });
  }
}
