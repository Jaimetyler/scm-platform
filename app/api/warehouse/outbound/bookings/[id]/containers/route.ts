import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseQuantities, parseRateAmount } from "@/lib/warehouse/outbound/carrier-rates";
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
async function findBooking(id: string, terminal: string, siteCode: string) {
  const { data, error } = await database().from("cotton_outbound_bookings").select("status")
    .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).maybeSingle();
  if (error) throw error;
  return data;
}
function user(req: NextRequest) { return staffActor(req); }

async function PATCHHandler(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    const booking = await findBooking(id, terminal, siteCode);
    if (!booking)
      return NextResponse.json({ ok: false, error: "Booking not found at this warehouse" }, { status: 404 });
    const { data: current, error: currentError } = await database().from("cotton_outbound_containers")
      .select("split_transfer_id,carrier_plan").eq("id", containerId).eq("booking_id", id).maybeSingle();
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
    let carrierPlan = current.carrier_plan;
    if (Object.hasOwn(body, "carrierPlan")) {
      if (booking.status !== "draft") return NextResponse.json({ error: "Only draft bookings can be priced." }, { status: 409 });
      carrierPlan = null;
      if (body.carrierPlan !== null) {
        const { rateId, quantities, basePayOverride } = body.carrierPlan ?? {};
        if (typeof rateId !== "string" || !/^[0-9a-f-]{36}$/i.test(rateId))
          return NextResponse.json({ error: "Choose a carrier rate." }, { status: 400 });
        let counts;
        let override = null;
        try {
          counts = parseQuantities(quantities);
          if (basePayOverride != null && basePayOverride !== "") override = parseRateAmount(basePayOverride, "base carrier pay");
          if (!cleanEquipment(body.containerNumber, 20)) throw new Error("Enter the container number before assigning a carrier.");
        } catch (error) {
          return NextResponse.json({ error: (error as Error).message }, { status: 400 });
        }
        let rate = current.carrier_plan?.rate;
        if (rate?.id !== rateId) {
          const result = await database().from("outbound_carrier_rates")
            .select("id,carrier_id,carrier_name,lane,rates,updated_at")
            .match({ id: rateId, terminal, site_code: siteCode }).maybeSingle();
          if (result.error) throw new Error("Could not load the carrier rate.");
          rate = result.data;
        }
        if (!rate) return NextResponse.json({ error: "That carrier rate is unavailable at this warehouse." }, { status: 400 });
        if (body.carrierPlan.rateVersion !== rate.updated_at)
          return NextResponse.json({ error: "The carrier rate changed. Reopen the booking before saving." }, { status: 409 });
        carrierPlan = { rate, quantities: counts, basePayOverride: override };
      }
    }
    let values;
    try {
      values = { booking_line_id: bookingLineId, container_number: cleanEquipment(body?.containerNumber, 20), seal_number: cleanEquipment(body?.sealNumber, 40),
        carrier_plan: carrierPlan, chassis_number: cleanEquipment(body?.chassisNumber, 40), notes: cleanNotes(body?.notes), updated_by: user(req) };
      if (carrierPlan && !values.container_number) throw new Error("Remove the carrier plan before clearing the container number.");
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid equipment details" }, { status: 400 });
    }
    const { data, error } = await database().from("cotton_outbound_containers").update(values)
      .eq("id", containerId).eq("booking_id", id).eq("updated_at", expectedUpdatedAt).is("split_transfer_id", null)
      .select("id,sequence_no,booking_line_id,container_number,seal_number,chassis_number,notes,updated_at,carrier_plan").maybeSingle();
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

export const PATCH = withStaffAccess(PATCHHandler);
