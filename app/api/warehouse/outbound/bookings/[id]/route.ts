import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";
export const runtime = "nodejs";
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const params = new URL(req.url).searchParams;
    const terminal = String(params.get("terminal") ?? "").toUpperCase();
    const siteCode = String(params.get("siteCode") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    const sb = createClient(url, key);
    const { data: booking, error } = await sb.from("cotton_outbound_bookings").select("*")
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
    if (error) throw error;
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    const { data: lines, error: lineError } = await sb.from("cotton_outbound_booking_lines")
      .select("id,source_row,mark,requested_bales,load_by,date_confirmed,shipping_order,source_warehouse_code,source_warehouse")
      .eq("booking_id", id).order("source_row");
    if (lineError) throw lineError;
    const { data: containers, error: containerError } = await sb.from("cotton_outbound_containers")
      .select("id,sequence_no,booking_line_id,container_number,seal_number,chassis_number,notes,updated_at,split_transfer_id")
      .eq("booking_id", id).order("sequence_no");
    if (containerError) throw containerError;
    const { data: transfers, error: transferError } = await sb.from("cotton_outbound_booking_transfers")
      .select("id,mark,bales,target_booking_id,target:cotton_outbound_bookings!target_booking_id(booking_number)")
      .eq("source_booking_id", id);
    if (transferError) throw transferError;
    const transferById = new Map((transfers ?? []).map((transfer) => [transfer.id, transfer]));
    const marks = [...new Set((lines ?? []).map((line) => line.mark))];
    const { data: lots, error: inventoryError } = await sb.from("warehouse_inventory_lots")
      .select("mark,current_bales,allocated_bales,inventory_status,warehouse_location,customer")
      .eq("terminal", terminal).eq("site_code", siteCode).in("mark", marks).limit(1000);
    if (inventoryError) throw inventoryError;
    const { data: inboundRows, error: inboundError } = await sb.from("inbound_checkin_rows")
      .select("mark,bol_bc,bale_count,yard_status")
      .eq("terminal", terminal).eq("site_code", siteCode).eq("material_type", "cotton")
      .eq("movement_direction", "delivery").in("mark", marks)
      .in("yard_status", ["waiting", "called", "in_door", "working"]);
    if (inboundError) throw inboundError;
    const inbound = new Map<string, { bales: number; statuses: Set<string> }>();
    for (const row of inboundRows ?? []) {
      const mark = String(row.mark ?? "").toUpperCase();
      const entry = inbound.get(mark) ?? { bales: 0, statuses: new Set<string>() };
      entry.bales += Number(row.bale_count ?? row.bol_bc ?? 0);
      if (row.yard_status) entry.statuses.add(row.yard_status);
      inbound.set(mark, entry);
    }
    const inventory = new Map<string, { available: number; locations: Set<string> }>();
    for (const lot of lots ?? []) {
      if (lot.inventory_status !== "active") continue;
      const entry = inventory.get(lot.mark) ?? { available: 0, locations: new Set<string>() };
      entry.available += Math.max(0, lot.current_bales - lot.allocated_bales);
      if (lot.warehouse_location) entry.locations.add(lot.warehouse_location);
      inventory.set(lot.mark, entry);
    }
    const requestedByMark = new Map<string, number>();
    for (const line of lines ?? []) requestedByMark.set(line.mark, (requestedByMark.get(line.mark) ?? 0) + line.requested_bales);
    return NextResponse.json({ ok: true, booking, containers: (containers ?? []).map((row) => {
      const transfer = row.split_transfer_id ? transferById.get(row.split_transfer_id) : null;
      const target = transfer?.target as unknown as { booking_number: string } | null;
      return { ...row, split: transfer ? { mark: transfer.mark, bales: transfer.bales,
        target_booking_id: transfer.target_booking_id, target_booking_number: target?.booking_number ?? "—" } : null };
    }), lines: (lines ?? []).map((line) => ({ ...line,
      mark_requested_total: requestedByMark.get(line.mark) ?? line.requested_bales,
      available_bales: inventory.get(line.mark)?.available ?? 0,
      inbound_bales: inbound.get(line.mark)?.bales ?? 0,
      inbound_statuses: [...(inbound.get(line.mark)?.statuses ?? [])],
      inventory_locations: [...(inventory.get(line.mark)?.locations ?? [])],
    })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load booking" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    const expectedUpdatedAt = String(body?.expectedUpdatedAt ?? "");
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt)))
      return NextResponse.json({ ok: false, error: "Reload the booking before editing details" }, { status: 409 });
    let values;
    try { values = normalizeBookingDetails(body); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid booking details" }, { status: 400 }); }
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    const { data, error } = await createClient(url, key).from("cotton_outbound_bookings").update(values)
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).eq("updated_at", expectedUpdatedAt).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "This booking changed or is no longer at this warehouse. Reload and review it." }, { status: 409 });
    return NextResponse.json({ ok: true, booking: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update booking details" }, { status: 500 });
  }
}
