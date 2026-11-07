import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { BOOKING_UPLOAD_BUCKET, signBookingUpload } from "@/lib/warehouse/outbound/booking-source";
import { validateBookingFile } from "@/lib/warehouse/outbound/upload-limits";
export const runtime = "nodejs";
export const POST = withStaffAccess(async (req: NextRequest) => {
  try {
    if (Number(req.headers.get("content-length") || 0) > 4096) throw Error("Invalid upload request.");
    const body = await req.json();
    const owner = staffProfile(req)?.user_id;
    if (!owner || !["DAL", "HOU", "SAV"].includes(body.terminal) || typeof body.filename !== "string" || body.filename.length > 200) throw Error("Invalid booking upload details.");
    validateBookingFile(body.filename, body.size);
    const path = `${owner}/${randomUUID()}.${body.filename.toLowerCase().endsWith(".xlsb") ? "xlsb" : "xlsx"}`;
    const receipt = signBookingUpload({ path, owner, terminal: body.terminal, name: body.filename, size: body.size, expires: Date.now() + 2 * 60 * 60 * 1000 }, process.env.SUPABASE_SERVICE_ROLE_KEY || "");
    const { data, error } = await staffDatabase().storage.from(BOOKING_UPLOAD_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw Error("Could not authorize the booking upload.");
    return NextResponse.json({ ok: true, signedUrl: data.signedUrl, receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not start upload." }, { status: 400 }); }
});
