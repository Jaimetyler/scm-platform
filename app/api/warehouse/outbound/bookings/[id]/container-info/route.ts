import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { containerInfoWorkbook } from "@/lib/warehouse/outbound/container-info";
export const runtime = "nodejs";
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const params = new URL(req.url).searchParams;
    const terminal = String(params.get("terminal") ?? "").toUpperCase(), siteCode = String(params.get("siteCode") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    const sb = createClient(url, key);
    const { data: booking, error } = await sb.from("cotton_outbound_bookings").select("*")
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
    if (error) throw error;
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    const [lineResult, equipmentResult] = await Promise.all([
      sb.from("cotton_outbound_booking_lines").select("id,mark,line_status,load_source,source_row").eq("booking_id", id),
      sb.from("cotton_outbound_containers").select("booking_line_id,container_number,seal_number,split_transfer_id,sequence_no").eq("booking_id", id),
    ]);
    if (lineResult.error) throw lineResult.error;
    if (equipmentResult.error) throw equipmentResult.error;
    const output = containerInfoWorkbook(booking, lineResult.data ?? [], equipmentResult.data ?? []);
    const filename = `SCM-Container-Info-${String(booking.booking_number).replace(/[^A-Za-z0-9_-]/g, "-")}.xlsx`;
    return new NextResponse(new Uint8Array(output), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (reason) {
    return NextResponse.json({ ok: false, error: reason instanceof Error ? reason.message : "Could not export container information" }, { status: 500 });
  }
}
