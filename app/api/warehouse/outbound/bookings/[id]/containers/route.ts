import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";
function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}
function cleanEquipment(value: unknown, max: number) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text.length > max || (text && !/^[A-Z0-9 ._/-]+$/.test(text))) throw new Error("Equipment numbers may only contain letters, numbers, spaces, periods, slashes, underscores, and hyphens.");
  return text || null;
}
function cleanNotes(value: unknown) {
  const text = String(value ?? "").trim();
  if (text.length > 500) throw new Error("Notes must be 500 characters or fewer.");
  return text || null;
}
function validSite(terminal: string, siteCode: string) {
  return CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton"));
}
async function ownsBooking(id: string, terminal: string, siteCode: string) {
  const { data, error } = await database().from("cotton_outbound_bookings").select("id")
    .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
function user(req: NextRequest) {
  try { return atob(req.headers.get("authorization")?.slice(6) ?? "").split(":")[0] || "warehouse user"; }
  catch { return "warehouse user"; }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    const containerId = String(body?.containerId ?? "");
    const expectedUpdatedAt = String(body?.expectedUpdatedAt ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(containerId) || !validSite(terminal, siteCode))
      return NextResponse.json({ ok: false, error: "Unknown booking, warehouse, or container" }, { status: 400 });
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt)))
      return NextResponse.json({ ok: false, error: "Reload this container before saving" }, { status: 409 });
    if (!(await ownsBooking(id, terminal, siteCode)))
      return NextResponse.json({ ok: false, error: "Booking not found at this warehouse" }, { status: 404 });
    const { data: current, error: currentError } = await database().from("cotton_outbound_containers")
      .select("split_transfer_id").eq("id", containerId).eq("booking_id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: false, error: "Container not found" }, { status: 404 });
    if (current.split_transfer_id) return NextResponse.json({ ok: false, error: "This mark was split to another booking. Its history row is locked." }, { status: 409 });
    const bookingLineId = body?.bookingLineId ? String(body.bookingLineId) : null;
    if (bookingLineId) {
      if (!/^[0-9a-f-]{36}$/i.test(bookingLineId)) return NextResponse.json({ ok: false, error: "Invalid mark assignment" }, { status: 400 });
      const { data: line, error: lineError } = await database().from("cotton_outbound_booking_lines")
        .select("id").eq("id", bookingLineId).eq("booking_id", id).maybeSingle();
      if (lineError) throw lineError;
      if (!line) return NextResponse.json({ ok: false, error: "That mark is not on this booking" }, { status: 400 });
    }
    let values;
    try {
      values = { booking_line_id: bookingLineId, container_number: cleanEquipment(body?.containerNumber, 20), seal_number: cleanEquipment(body?.sealNumber, 40),
        chassis_number: cleanEquipment(body?.chassisNumber, 40), notes: cleanNotes(body?.notes), updated_by: user(req) };
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid equipment details" }, { status: 400 });
    }
    const { data, error } = await database().from("cotton_outbound_containers").update(values)
      .eq("id", containerId).eq("booking_id", id).eq("updated_at", expectedUpdatedAt).is("split_transfer_id", null)
      .select("id,sequence_no,booking_line_id,container_number,seal_number,chassis_number,notes,updated_at").maybeSingle();
    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json({ ok: false, error: duplicate ? "That container number is already on this booking." : error.message }, { status: duplicate ? 409 : 400 });
    }
    if (!data) return NextResponse.json({ ok: false, error: "This container changed in another browser. Reload and review it." }, { status: 409 });
    return NextResponse.json({ ok: true, container: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save container" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !validSite(terminal, siteCode) || !(await ownsBooking(id, terminal, siteCode)))
      return NextResponse.json({ ok: false, error: "Booking not found at this warehouse" }, { status: 404 });
    const sb = database();
    const { data: last, error: lastError } = await sb.from("cotton_outbound_containers").select("sequence_no")
      .eq("booking_id", id).order("sequence_no", { ascending: false }).limit(1).maybeSingle();
    if (lastError) throw lastError;
    const { data, error } = await sb.from("cotton_outbound_containers")
      .insert({ booking_id: id, sequence_no: (last?.sequence_no ?? 0) + 1, updated_by: user(req) })
      .select("id,sequence_no,booking_line_id,container_number,seal_number,chassis_number,notes,updated_at").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, container: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not add container" }, { status: 500 });
  }
}
