import { readBookingSource, BOOKING_UPLOAD_BUCKET } from "@/lib/warehouse/outbound/booking-source";
import { staffDatabase } from "@/lib/auth/session";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { parseBookingRequest, prepareBookingImport, bookingImportOptions } from "@/lib/warehouse/outbound/booking-import";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";
export const maxDuration = 120;
async function POSTHandler(req: NextRequest) {
  try {
    const form = await req.formData();
    const terminal = String(form.get("terminal") ?? "").toUpperCase();
    const siteCode = String(form.get("siteCode") ?? "");
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode && item.materials.includes("cotton"));
    if (!site) return NextResponse.json({ ok: false, error: "Choose a cotton warehouse." }, { status: 400 });
    const source = await readBookingSource(form, { owner: staffProfile(req)?.user_id ?? "", terminal,
      secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", download: path => staffDatabase().storage.from(BOOKING_UPLOAD_BUCKET).download(path) });
    const options = bookingImportOptions(form);
    const booking = prepareBookingImport(parseBookingRequest(source.bytes, options), terminal, siteCode, options, false);
    return NextResponse.json({ ok: true, site, booking, mismatches: [],
      sourceLoads: booking.lines.filter((line) => line.loadSource === "source_load").length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read booking request" }, { status: 400 });
  }
}

export const POST = withStaffAccess(POSTHandler);
