import { NextRequest, NextResponse } from "next/server";
import { parseBungeBooking, warehouseMatchesSite } from "@/lib/warehouse/outbound/bunge";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const terminal = String(form.get("terminal") ?? "").toUpperCase();
    const siteCode = String(form.get("siteCode") ?? "");
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode && item.materials.includes("cotton"));
    if (!site) return NextResponse.json({ ok: false, error: "Choose a Savannah or Houston cotton warehouse." }, { status: 400 });
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || !/\.xlsx$/i.test(file.name))
      return NextResponse.json({ ok: false, error: "Choose a Bunge .xlsx file under 4 MB." }, { status: 400 });
    const booking = parseBungeBooking(Buffer.from(await file.arrayBuffer()));
    const mismatches = booking.lines.filter((line) => !warehouseMatchesSite(line.warehouse, terminal, siteCode, booking.warehouseDetails[line.warehouseCode]));
    return NextResponse.json({ ok: true, site, booking, mismatches: mismatches.map((line) => ({ row: line.sourceRow, warehouse: line.warehouse })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read booking request" }, { status: 400 });
  }
}
