import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { previewDallasBungeDrays } from "@/lib/dray/dallas-booking";

export const runtime = "nodejs";

export const POST = withStaffAccess(async (request: NextRequest) => {
  try {
    const file = (await request.formData()).get("booking");
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || !file.size || file.size > 4 * 1024 * 1024) {
      throw Error("Choose an original Bunge .xlsx booking request up to 4 MB.");
    }
    const preview = previewDallasBungeDrays(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Booking could not be read." }, { status: 400 });
  }
});
