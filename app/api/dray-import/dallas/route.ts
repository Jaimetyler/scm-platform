import { readBookingSource, BOOKING_UPLOAD_BUCKET } from "@/lib/warehouse/outbound/booking-source";
import { staffDatabase } from "@/lib/auth/session";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = withStaffAccess(async (request: NextRequest) => {
  try {
    const form = await request.formData();
    const source = await readBookingSource(form, { owner: staffProfile(request)?.user_id ?? "", terminal: "DAL",
      secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", download: path => staffDatabase().storage.from(BOOKING_UPLOAD_BUCKET).download(path) }, "booking");
    const preview = previewDallasBungeDrays(source.bytes);
    return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Booking could not be read." }, { status: 400 });
  }
});
