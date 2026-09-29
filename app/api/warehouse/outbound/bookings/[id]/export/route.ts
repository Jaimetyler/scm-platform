import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
export const runtime = "nodejs";
function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const params = new URL(req.url).searchParams;
    const terminal = String(params.get("terminal") ?? "").toUpperCase();
    const siteCode = String(params.get("siteCode") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    const sb = database();
    const { data: booking, error: bookingError } = await sb.from("cotton_outbound_bookings").select("*")
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    const [{ data: lines, error: lineError }, { data: containers, error: containerError }] = await Promise.all([
      sb.from("cotton_outbound_booking_lines").select("id,mark,requested_bales,load_by,date_confirmed,shipping_order,source_warehouse_code,source_warehouse")
        .eq("booking_id", id).order("source_row"),
      sb.from("cotton_outbound_containers").select("sequence_no,booking_line_id,container_number,seal_number,chassis_number,notes")
        .eq("booking_id", id).order("sequence_no"),
    ]);
    if (lineError) throw lineError;
    if (containerError) throw containerError;
    const lineById = new Map((lines ?? []).map((line) => [line.id, line]));
    const marks = [...new Set((lines ?? []).map((line) => line.mark))];
    const [{ data: lots, error: lotError }, { data: inboundRows, error: inboundError }] = await Promise.all([
      sb.from("warehouse_inventory_lots").select("mark,current_bales,allocated_bales,inventory_status,warehouse_location")
        .eq("terminal", terminal).eq("site_code", siteCode).in("mark", marks),
      sb.from("inbound_checkin_rows").select("mark,bol_bc,bale_count,yard_status")
        .eq("terminal", terminal).eq("site_code", siteCode).eq("material_type", "cotton").eq("movement_direction", "delivery")
        .in("mark", marks).in("yard_status", ["waiting", "called", "in_door", "working"]),
    ]);
    if (lotError) throw lotError;
    if (inboundError) throw inboundError;
    const availability = new Map<string, { bales: number; locations: Set<string> }>();
    for (const lot of lots ?? []) {
      if (lot.inventory_status !== "active") continue;
      const entry = availability.get(lot.mark) ?? { bales: 0, locations: new Set<string>() };
      entry.bales += Math.max(0, lot.current_bales - lot.allocated_bales);
      if (lot.warehouse_location) entry.locations.add(lot.warehouse_location);
      availability.set(lot.mark, entry);
    }
    const inbound = new Map<string, number>();
    for (const row of inboundRows ?? []) inbound.set(row.mark, (inbound.get(row.mark) ?? 0) + Number(row.bale_count ?? row.bol_bc ?? 0));
    const requested = new Map<string, number>();
    for (const line of lines ?? []) requested.set(line.mark, (requested.get(line.mark) ?? 0) + line.requested_bales);
    const workbook = XLSX.utils.book_new();
    const equipmentRows = (containers ?? []).map((row) => {
      const line = row.booking_line_id ? lineById.get(row.booking_line_id) : null;
      const available = line ? availability.get(line.mark)?.bales ?? 0 : 0;
      const inboundBales = line ? inbound.get(line.mark) ?? 0 : 0;
      const requestedForMark = line ? requested.get(line.mark) ?? line.requested_bales : 0;
      const status = !line ? "Extra container" : available > 0 ? "In warehouse" : inboundBales > 0 ? "In delivery line" : "Not in warehouse";
      return { "Container #": row.sequence_no, Mark: line?.mark ?? "", Status: status,
        "Requested bales": line?.requested_bales ?? "", "Available bales": line ? available : "",
        "Inbound line bales": line ? inboundBales : "", Difference: line ? available - requestedForMark : "",
        "Load by": line?.load_by ?? "", "Shipping order": line?.shipping_order ?? "",
        Location: line ? [...(availability.get(line.mark)?.locations ?? [])].join(", ") : "",
        "Container number": row.container_number ?? "",
        "Seal number": row.seal_number ?? "", "Chassis number": row.chassis_number ?? "", Notes: row.notes ?? "" };
    });
    const equipmentSheet = XLSX.utils.json_to_sheet(equipmentRows.length ? equipmentRows : [{ "Container #": "" }]);
    equipmentSheet["!cols"] = [10, 14, 18, 16, 16, 18, 14, 14, 18, 20, 22, 18, 20, 30].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, equipmentSheet, "Load Plan");
    const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const filename = `SCM-Outbound-${String(booking.booking_number).replace(/[^A-Za-z0-9_-]/g, "-")}.xlsx`;
    return new NextResponse(new Uint8Array(output), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store",
    } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not export booking" }, { status: 500 });
  }
}
