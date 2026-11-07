import { withStaffAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { parseBookingRequest, prepareBookingImport, bookingImportOptions } from "@/lib/warehouse/outbound/booking-import";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";
async function POSTHandler(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const terminal = String(form.get("terminal") ?? "").toUpperCase();
    const siteCode = String(form.get("siteCode") ?? "");
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode && item.materials.includes("cotton"));
    if (!site) return NextResponse.json({ ok: false, error: "Choose a cotton warehouse." }, { status: 400 });
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || !/\.(xlsx|xlsb)$/i.test(file.name))
      return NextResponse.json({ ok: false, error: "Choose a supported .xlsx or .xlsb booking request under 4 MB." }, { status: 400 });
    const options = bookingImportOptions(form);
    const booking = prepareBookingImport(parseBookingRequest(Buffer.from(await file.arrayBuffer()), options), terminal, siteCode, options, false);
    return NextResponse.json({ ok: true, site, booking, mismatches: [],
      sourceLoads: booking.lines.filter((line) => line.loadSource === "source_load").length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read booking request" }, { status: 400 });
  }
}

export const POST = withStaffAccess(POSTHandler);
