import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
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
      .select("source_row,mark,requested_bales,load_by,date_confirmed,shipping_order,source_warehouse_code,source_warehouse")
      .eq("booking_id", id).order("source_row");
    if (lineError) throw lineError;
    const marks = [...new Set((lines ?? []).map((line) => line.mark))];
    const { data: lots, error: inventoryError } = await sb.from("warehouse_inventory_lots")
      .select("mark,current_bales,allocated_bales,inventory_status,warehouse_location,customer")
      .eq("terminal", terminal).eq("site_code", siteCode).in("mark", marks).limit(1000);
    if (inventoryError) throw inventoryError;
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
    return NextResponse.json({ ok: true, booking, lines: (lines ?? []).map((line) => ({ ...line,
      mark_requested_total: requestedByMark.get(line.mark) ?? line.requested_bales,
      available_bales: inventory.get(line.mark)?.available ?? 0,
      inventory_locations: [...(inventory.get(line.mark)?.locations ?? [])],
    })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load booking" }, { status: 500 });
  }
}
