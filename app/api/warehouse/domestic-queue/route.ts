import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";
import { lookupMcleodOrderById } from "@/lib/inbound/checkin/mcleod-order-id";

export const runtime = "nodejs";

const NEXT: Record<string, string[]> = {
  waiting: ["called", "cancelled"],
  called: ["in_door", "waiting", "cancelled"],
  in_door: ["working", "called", "cancelled"],
  working: ["completed", "in_door", "cancelled"],
};
const TIMESTAMP: Record<string, string> = {
  called: "yard_called_at", in_door: "yard_in_door_at",
  working: "yard_work_started_at", completed: "yard_completed_at",
  cancelled: "yard_completed_at",
};

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

function siteExists(terminal: string, siteCode: string) {
  return CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode);
}

function user(req: NextRequest) {
  try { return atob(req.headers.get("authorization")?.slice(6) ?? "").split(":")[0] || "warehouse user"; }
  catch { return "warehouse user"; }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const terminal = String(searchParams.get("terminal") ?? "").toUpperCase();
    const siteCode = String(searchParams.get("siteCode") ?? "");
    if (!siteExists(terminal, siteCode)) return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });

    const { data, error } = await database().from("inbound_checkin_rows")
      .select("id,updated_at,checked_in_at,driver_name,driver_phone,movement_direction,material_type,reference_number,destination,shipper,matched_order_id,warehouse_location,comment_1,mark,bol_bc,draft_status,bol_photo_path,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at")
      .eq("terminal", terminal).eq("site_code", siteCode)
      .in("material_type", ["lumber", "other"])
      .gte("checked_in_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("checked_in_at", { ascending: false }).limit(200);
    if (error) throw error;
    return NextResponse.json({ ok: true, rows: (data ?? []).map(({ bol_photo_path, ...row }) => ({ ...row, has_bol_photo: Boolean(bol_photo_path) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Could not load domestic queue") }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").trim().toUpperCase();
    const siteCode = String(body?.siteCode ?? "").trim();
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode);
    const direction = String(body?.movementDirection ?? "").trim();
    const material = String(body?.materialType ?? "").trim();
    let reference = String(body?.referenceNumber ?? "").trim().toUpperCase();
    let customer = String(body?.customer ?? "").trim().toUpperCase();
    const orderId = String(body?.orderId ?? "").trim();
    const driverName = String(body?.driverName ?? "").trim();
    const driverPhone = String(body?.driverPhone ?? "").trim();
    const destination = String(body?.destination ?? "").trim().toUpperCase();
    const location = String(body?.warehouseLocation ?? "").trim().toUpperCase();
    const notes = String(body?.notes ?? "").trim();
    if (!site || !["pickup", "delivery"].includes(direction) || !["lumber", "other"].includes(material) ||
        (!reference && !orderId) || reference.length > 200 || customer.length > 200 || driverName.length > 120 ||
        driverPhone.length > 40 || destination.length > 200 || location.length > 120 || notes.length > 500) {
      return NextResponse.json({ ok: false, error: "Enter a valid site, move, material, and reference" }, { status: 400 });
    }
    if (orderId) {
      const order = await lookupMcleodOrderById(orderId, direction);
      if (reference && !order.reference.includes(reference)) {
        return NextResponse.json({ ok: false, error: `Order ${orderId} ${order.field} does not contain ${reference}` }, { status: 409 });
      }
      reference ||= order.reference;
      customer = order.customer;
    }
    if (reference.length > 200) return NextResponse.json({ ok: false, error: "McLeod reference is too long" }, { status: 400 });
    const now = new Date();
    const { data, error } = await database().from("inbound_checkin_rows").insert({
      terminal, site_code: siteCode, site_name: site.siteName, sub_location: site.subLocations[0] ?? "MAIN",
      received_date: warehouseDate(now, site.terminal), checked_in_at: now.toISOString(),
      checkin_source: "staff", draft_status: "checked_in", yard_status: "waiting",
      movement_direction: direction, material_type: material, reference_number: reference,
      shipper: customer || null, matched_order_id: orderId || null,
      driver_name: driverName || null, driver_phone: driverPhone || null,
      destination: direction === "pickup" ? destination || null : null,
      warehouse_location: location || null, comment_1: notes || null, verified: false,
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save manual check-in" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id ?? "");
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? "");
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    if (body?.action === "set_customer" || body?.action === "match_order" || body?.action === "edit_field") {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode) || !body.expectedUpdatedAt) {
        return NextResponse.json({ ok: false, error: "Invalid check-in update" }, { status: 400 });
      }
      const sb = database();
      const { data: existing, error: lookupError } = await sb.from("inbound_checkin_rows")
        .select("id,updated_at,reference_number,movement_direction,matched_order_id")
        .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
        .in("material_type", ["lumber", "other"]).single();
      if (lookupError || !existing) return NextResponse.json({ ok: false, error: "Check-in not found" }, { status: 404 });
      if (existing.updated_at !== body.expectedUpdatedAt) return NextResponse.json({ ok: false, error: "This row changed. Refresh before saving." }, { status: 409 });
      if (body.action === "edit_field") {
        const field = String(body.field ?? "");
        if (!["reference_number", "warehouse_location", "comment_1"].includes(field)) {
          return NextResponse.json({ ok: false, error: "Invalid sheet field" }, { status: 400 });
        }
        const value = String(body.value ?? "").trim().toUpperCase();
        if ((field === "reference_number" && !value) || value.length > 200) {
          return NextResponse.json({ ok: false, error: "Enter a valid value" }, { status: 400 });
        }
        const changedReference = field === "reference_number" && value !== existing.reference_number;
        const updates = { [field]: value || null,
          ...(changedReference && existing.matched_order_id ? { matched_order_id: null, shipper: null } : {}) };
        const { data, error } = await sb.from("inbound_checkin_rows").update(updates)
          .eq("id", id).eq("updated_at", body.expectedUpdatedAt)
          .select("id,updated_at,reference_number,warehouse_location,comment_1,shipper,matched_order_id").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ ok: false, error: "This row changed. Refresh before saving." }, { status: 409 });
        return NextResponse.json({ ok: true, row: data });
      }
      let customer = String(body.customer ?? "").trim().toUpperCase();
      let orderId: string | null = null;
      if (body.action === "match_order") {
        orderId = String(body.orderId ?? "").trim();
        const order = await lookupMcleodOrderById(orderId, existing.movement_direction);
        const reference = String(existing.reference_number ?? "").trim().toUpperCase();
        if (!reference || !order.reference.includes(reference)) {
          return NextResponse.json({ ok: false, error: "That order does not contain the driver's reference in the required field" }, { status: 409 });
        }
        customer = order.customer;
      }
      if (!customer || customer.length > 200) return NextResponse.json({ ok: false, error: "Enter a customer" }, { status: 400 });
      const { data, error } = await sb.from("inbound_checkin_rows")
        .update({ shipper: customer, matched_order_id: orderId })
        .eq("id", id).eq("updated_at", body.expectedUpdatedAt)
        .select("id,updated_at,shipper,matched_order_id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "This row changed. Refresh before saving." }, { status: 409 });
      return NextResponse.json({ ok: true, row: data });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode) || !NEXT[from]?.includes(to)) {
      return NextResponse.json({ ok: false, error: "Invalid queue transition" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { data, error } = await database().from("inbound_checkin_rows")
      .update({ yard_status: to, [TIMESTAMP[to]]: now, yard_updated_by: user(req) })
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
      .in("material_type", ["lumber", "other"]).eq("yard_status", from)
      .select("id,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "This arrival changed. Refresh the queue." }, { status: 409 });
    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Could not update domestic queue") }, { status: 500 });
  }
}
