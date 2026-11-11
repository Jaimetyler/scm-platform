import { checkLdcOrder } from "@/lib/warehouse/outbound/e2open-mcleod";
import { findE2openDocuments } from "@/lib/sharepoint/e2open-documents";
import { isSavannahE2openBooking } from "@/lib/warehouse/outbound/e2open-customer";
import { staffProfile, withStaffAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { normalizeBookingDetails } from "@/lib/warehouse/outbound/details";
export const runtime = "nodejs";
export const maxDuration = 120;
async function GETHandler(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
      .select("id,source_row,mark,requested_bales,load_by,date_confirmed,shipping_order,source_warehouse_code,source_warehouse,line_status,load_source,status_note,status_changed_at,status_changed_by")
      .eq("booking_id", id).order("source_row");
    if (lineError) throw lineError;
    const { data: containers, error: containerError } = await sb.from("cotton_outbound_containers")
      .select("id,sequence_no,booking_line_id,container_number,seal_number,chassis_number,notes,updated_at,split_transfer_id")
      .eq("booking_id", id).order("sequence_no");
    if (containerError) throw containerError;
    if (["e2open", "mcleod"].includes(params.get("documents") ?? "")) {
      const staff = staffProfile(req);
      if (!isSavannahE2openBooking(terminal, booking.customer) ||
          !(staff?.role === "admin" || staff?.role === "operator" && staff.terminal === terminal))
        return NextResponse.json({ ok: false, error: "Available to Savannah staff for Louis Dreyfus bookings." }, { status: 403 });
      const bookingNumber = booking.booking_number.trim();
      if (!/^[a-z0-9-]+$/i.test(bookingNumber))
        return NextResponse.json({ ok: false, error: "The booking number cannot be used to locate documents." }, { status: 400 });
      const activeLineIds = new Set((lines ?? []).filter((line) => line.line_status === "active").map((line) => line.id));
      const containerNumbers = [...new Set((containers ?? [])
        .filter((row) => !row.split_transfer_id && (!row.booking_line_id || activeLineIds.has(row.booking_line_id)))
        .map((row) => String(row.container_number ?? "").trim().toUpperCase())
        .filter((number) => /^[A-Z]{4}\d{7}$/.test(number)))];
      if (params.get("documents") === "mcleod") {
        const requested = String(params.get("container") ?? "").trim().toUpperCase();
        if (!containerNumbers.includes(requested))
          return NextResponse.json({ error: "Choose a saved container on this booking." }, { status: 400 });
        const equipment = (containers ?? []).find(row => !row.split_transfer_id && String(row.container_number ?? "").trim().toUpperCase() === requested);
        const line = (lines ?? []).find(row => row.id === equipment?.booking_line_id && row.line_status === "active");
        return NextResponse.json(await checkLdcOrder(bookingNumber, requested, line?.mark ?? "", line?.shipping_order ?? ""), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      try {
        return NextResponse.json(await findE2openDocuments(bookingNumber, containerNumbers), {
          headers: { "Cache-Control": "private, no-store" },
        });
      } catch {
        return NextResponse.json({ error: "Could not check the booking folders in SharePoint." }, { status: 502 });
      }
    }
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
      .select("mark,bol_bc,bale_count,driver_reported_bales,yard_status")
      .eq("terminal", terminal).eq("site_code", siteCode).eq("material_type", "cotton")
      .eq("movement_direction", "delivery").in("mark", marks)
      .in("yard_status", ["waiting", "called", "in_door", "working"])
      .in("draft_status", ["draft", "checked_in", "ready", "processing", "failed"]);
    if (inboundError) throw inboundError;
    const inbound = new Map<string, { bales: number; statuses: Set<string> }>();
    for (const row of inboundRows ?? []) {
      const mark = String(row.mark ?? "").toUpperCase();
      const entry = inbound.get(mark) ?? { bales: 0, statuses: new Set<string>() };
      entry.bales += Number(row.bale_count ?? row.driver_reported_bales ?? row.bol_bc ?? 0);
      if (row.yard_status) entry.statuses.add(row.yard_status);
      inbound.set(mark, entry);
    }
    const inventory = new Map<string, { available: number; warehouse: number; locations: Set<string> }>();
    for (const lot of lots ?? []) {
      if (!["active", "on_hold"].includes(lot.inventory_status)) continue;
      const entry = inventory.get(lot.mark) ?? { available: 0, warehouse: 0, locations: new Set<string>() };
      entry.warehouse += Number(lot.current_bales);
      if (lot.inventory_status === "active") entry.available += Math.max(0, lot.current_bales - lot.allocated_bales);
      if (Number(lot.current_bales) > 0 && lot.warehouse_location) entry.locations.add(lot.warehouse_location);
      inventory.set(lot.mark, entry);
    }
    const requestedByMark = new Map<string, number>();
    for (const line of (lines ?? []).filter((line) => line.line_status === "active" && line.load_source === "warehouse")) requestedByMark.set(line.mark, (requestedByMark.get(line.mark) ?? 0) + line.requested_bales);
    const { data: alerts, error: alertError } = await sb.from("cotton_outbound_source_arrivals")
      .select("line_id,arrival_site_name,checkin_id").in("line_id", (lines ?? []).map((line) => line.id)).is("resolved_at", null);
    if (alertError) throw alertError;
    return NextResponse.json({ ok: true, booking, containers: (containers ?? []).map((row) => {
      const transfer = row.split_transfer_id ? transferById.get(row.split_transfer_id) : null;
      const target = transfer?.target as unknown as { booking_number: string } | null;
      return { ...row, split: transfer ? { mark: transfer.mark, bales: transfer.bales,
        target_booking_id: transfer.target_booking_id, target_booking_number: target?.booking_number ?? "—" } : null };
    }), lines: (lines ?? []).map((line) => ({ ...line,
      source_arrivals: (alerts ?? []).filter((alert) => alert.line_id === line.id),
      mark_requested_total: requestedByMark.get(line.mark) ?? line.requested_bales,
      available_bales: inventory.get(line.mark)?.available ?? 0,
      warehouse_bales: inventory.get(line.mark)?.warehouse ?? 0,
      inbound_bales: inbound.get(line.mark)?.bales ?? 0,
      inbound_statuses: [...(inbound.get(line.mark)?.statuses ?? [])],
      inventory_locations: [...(inventory.get(line.mark)?.locations ?? [])],
    })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load booking" }, { status: 500 });
  }
}

async function PATCHHandler(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking or warehouse" }, { status: 400 });
    const destination = body.destinationSiteCode === undefined || body.destinationSiteCode === siteCode ? undefined :
      CHECKIN_SITES.find(site => site.terminal === "DAL" && site.siteCode === body.destinationSiteCode && site.materials.includes("cotton"));
    if (body.destinationSiteCode !== undefined && body.destinationSiteCode !== siteCode && (terminal !== "DAL" || !destination))
      return NextResponse.json({ ok: false, error: "Choose a Dallas cotton warehouse." }, { status: 400 });
    const expectedUpdatedAt = String(body?.expectedUpdatedAt ?? "");
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt)))
      return NextResponse.json({ ok: false, error: "Reload the booking before editing details" }, { status: 409 });
    const lifecycleStatus = body.lifecycleStatus;
    if (lifecycleStatus !== undefined && !["draft", "archived", "cancelled"].includes(lifecycleStatus))
      return NextResponse.json({ ok: false, error: "Unknown booking status." }, { status: 400 });
    let values;
    try { values = lifecycleStatus === undefined ? normalizeBookingDetails(body) : { status: lifecycleStatus }; }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid booking details" }, { status: 400 }); }
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    let update = createClient(url, key).from("cotton_outbound_bookings").update({
      ...values,
      ...(destination && lifecycleStatus === undefined ? { site_code: destination.siteCode, site_name: destination.siteName } : {}),
    })
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).eq("updated_at", expectedUpdatedAt);
    update = lifecycleStatus === "draft"
      ? update.in("status", ["archived", "cancelled"]) : update.eq("status", "draft");
    const { data, error } = await update.select("*").maybeSingle();
    if (destination && error?.code === "23505")
      return NextResponse.json({ ok: false, error: `This booking already exists at ${destination.siteName}.` }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "This booking changed or is no longer at this warehouse. Reload and review it." }, { status: 409 });
    return NextResponse.json({ ok: true, booking: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update booking details" }, { status: 500 });
  }
}

export const GET = withStaffAccess(GETHandler);
export const PATCH = withStaffAccess(PATCHHandler);
