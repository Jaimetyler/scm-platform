import { readBookingSource, BOOKING_UPLOAD_BUCKET } from "@/lib/warehouse/outbound/booking-source";
import { staffDatabase } from "@/lib/auth/session";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { parseBookingRequest, prepareBookingImport, bookingImportOptions } from "@/lib/warehouse/outbound/booking-import";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";

export const runtime = "nodejs";
export const maxDuration = 120;
function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}
async function GETHandler(req: NextRequest) {
  try {
    const terminal = String(new URL(req.url).searchParams.get("terminal") ?? "").toUpperCase();
    const siteCode = String(new URL(req.url).searchParams.get("siteCode") ?? "");
    const allWarehouses = !terminal && !siteCode;
    if (!allWarehouses && !CHECKIN_SITES.some((site) => site.terminal === terminal && (!siteCode || site.siteCode === siteCode) && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown cotton warehouse" }, { status: 400 });
    let query = database().from("cotton_outbound_booking_search_dashboard").select("*");
    query = allWarehouses ? query.or(CHECKIN_SITES.filter((site) => site.materials.includes("cotton"))
      .map((site) => `and(terminal.eq.${site.terminal},site_code.eq.${site.siteCode})`).join(",")) : query.eq("terminal", terminal);
    if (siteCode) query = query.eq("site_code", siteCode);
    const { data, error } = await query.order("cutoff", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    return NextResponse.json({ ok: true, bookings: data ?? [], limitReached: data?.length === 1000 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load bookings" }, { status: 500 });
  }
}
async function POSTHandler(req: NextRequest) {
  try {
    const form = await req.formData();
    const terminal = String(form.get("terminal") ?? "").toUpperCase();
    const siteCode = String(form.get("siteCode") ?? "");
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode && item.materials.includes("cotton"));
    if (!site) return NextResponse.json({ ok: false, error: "Unknown cotton warehouse" }, { status: 400 });
    const source = await readBookingSource(form, { owner: staffProfile(req)?.user_id ?? "", terminal,
      secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", download: path => staffDatabase().storage.from(BOOKING_UPLOAD_BUCKET).download(path) });
    const options = bookingImportOptions(form);
    const booking = prepareBookingImport(parseBookingRequest(source.bytes, options), terminal, siteCode, options, true);
    if (form.get("datesConfirmed") !== "true") return NextResponse.json({ ok: false,
      error: "Review and confirm the sailing dates before importing." }, { status: 400 });
    const sailing = normalizeBookingDetails({ erd: String(form.get("erd") ?? ""), docCutoff: String(form.get("docCutoff") ?? ""),
      cutoff: String(form.get("cutoff") ?? ""), vessel: String(form.get("vessel") ?? "") });
    if (booking.warnings.length) return NextResponse.json({ ok: false,
      error: booking.warnings.join(" ") + " Correct the source sheet before importing." }, { status: 409 });
    const { data, error } = await database().rpc("create_cotton_outbound_booking_import", {
      p_terminal: terminal, p_site_code: siteCode, p_site_name: site.siteName,
      p_customer: booking.customer, p_booking_number: booking.bookingNumber,
      p_customer_reference: booking.customerReference, p_containers: booking.containers,
      p_total_bales: booking.totalBales, p_source_filename: source.name.slice(0, 200), p_lines: booking.lines,
      p_details: { ...sailing, source_format: booking.sourceFormat },
    });
    if (error) return NextResponse.json({ ok: false,
      error: error.code === "23505" ? "This booking already exists at this warehouse." : error.message }, { status: error.code === "23505" ? 409 : 400 });
    return NextResponse.json({ ok: true, id: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save booking" }, { status: 400 });
  }
}

export const GET = withStaffAccess(GETHandler);
export const POST = withStaffAccess(POSTHandler);
