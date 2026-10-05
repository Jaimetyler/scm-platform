import { withStaffAccess, staffActor } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";
import { lookupMcleodOrderById, lookupMcleodGateOrder } from "@/lib/inbound/checkin/mcleod-order-id";
import { formatWarehouseTime, planLiveDeliveryActuals } from "@/lib/inbound/checkin/mcleod-time";
import { isCompleteCheckin } from "@/lib/inbound/checkin/ready";
import { processCheckinRow } from "@/lib/inbound/checkin/process-row";
import { lookupScmCarrier } from "@/lib/inbound/checkin/scm-carrier";
import { backfillTruckingCompanies } from "@/lib/inbound/checkin/backfill-trucking-company";

import { cottonShortage, shortageAcknowledged, acknowledgeShortage } from "@/lib/inbound/checkin/shortage";

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

function user(req: NextRequest) { return staffActor(req); }

async function GETHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const terminal = String(searchParams.get("terminal") ?? "").toUpperCase();
    const siteCode = String(searchParams.get("siteCode") ?? "");
    if (!siteExists(terminal, siteCode)) return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });

    const line = searchParams.get("view") === "line";
    const { data, error } = await database().from("inbound_checkin_rows")
      .select("id,terminal,site_name,checkin_source,updated_at,checked_in_at,driver_name,driver_phone,trucking_company,movement_direction,material_type,reference_number,destination,shipper,matched_order_id,warehouse_location,equipment_type,comment_1,mark,bol_bc,bale_count,expected_bale_count,driver_reported_bales,shortage_acknowledged_at,shortage_acknowledged_by,shortage_expected_bales,shortage_received_bales,shortage_note,customer_notified_at,customer_notified_by,draft_status,bol_photo_path,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at")
      .eq("terminal", terminal).eq("site_code", siteCode)
      .in("material_type", line ? ["cotton", "lumber", "other"] : ["lumber", "other"])
      .gte("checked_in_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("checked_in_at", { ascending: false }).limit(line ? 500 : 200);
    if (error) throw error;
    const displayRows = await backfillTruckingCompanies(data ?? [], false);
    const carriers = new Map<string, { carrierCode: string | null; scmCarrier: boolean }>();
    if (line) {
      const ids = [...new Set(displayRows.filter((row) =>
        ["waiting", "called", "in_door", "working"].includes(row.yard_status) && row.matched_order_id
      ).map((row) => String(row.matched_order_id)))];
      await Promise.all(ids.map(async (id) => {
        try { carriers.set(id, await lookupScmCarrier(id)); }
        catch { /* Keep the line available when McLeod cannot supply carrier details. */ }
      }));
    }
    return NextResponse.json({ ok: true, rows: displayRows.map(({ bol_photo_path, ...row }) => ({
      ...row, has_bol_photo: Boolean(bol_photo_path),
      ...(line && row.matched_order_id ? { carrier_code: carriers.get(String(row.matched_order_id))?.carrierCode ?? null,
        scm_carrier: carriers.get(String(row.matched_order_id))?.scmCarrier ?? false } : {}),
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Could not load domestic queue") }, { status: 500 });
  }
}

async function POSTHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").trim().toUpperCase();
    const siteCode = String(body?.siteCode ?? "").trim();
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode);
    const direction = String(body?.movementDirection ?? "").trim();
    let material = String(body?.materialType ?? "").trim();
    let reference = String(body?.referenceNumber ?? "").trim().toUpperCase();
    let customer = String(body?.customer ?? "").trim().toUpperCase();
    const orderId = String(body?.orderId ?? "").trim();
    const driverName = String(body?.driverName ?? "").trim();
    const driverPhone = String(body?.driverPhone ?? "").trim();
    let truckingCompany = String(body?.truckingCompany ?? "").trim();
    let destination = String(body?.destination ?? "").trim().toUpperCase();
    const location = String(body?.warehouseLocation ?? "").trim().toUpperCase();
    const notes = String(body?.notes ?? "").trim();
    if (!site || !site.materials.includes(material as "cotton" | "lumber" | "other") || !["pickup", "delivery"].includes(direction) || !["lumber", "other"].includes(material) ||
        (!reference && !orderId) || reference.length > 200 || customer.length > 200 || driverName.length > 120 ||
        driverPhone.length > 40 || truckingCompany.length > 200 || destination.length > 200 || location.length > 120 || notes.length > 500) {
      return NextResponse.json({ ok: false, error: "Enter a valid site, move, material, and reference" }, { status: 400 });
    }
    if (orderId) {
      const order = await lookupMcleodOrderById(orderId, direction);
      const yardOrder = await lookupMcleodGateOrder(orderId, site.terminal, site.siteName);
      if (yardOrder.direction !== direction) return NextResponse.json({ ok: false, error: "This order belongs to a different move at this yard" }, { status: 409 });
      if (yardOrder.completion) {
        return NextResponse.json({ ok: false, error: yardOrder.completion.message, completion: yardOrder.completion }, { status: 409 });
      }
      if (order.materialType === "cotton") return NextResponse.json({ ok: false, error: "Use the Cotton grid for this order" }, { status: 409 });
      if (reference && !order.reference.includes(reference)) {
        return NextResponse.json({ ok: false, error: `Order ${orderId} ${order.field} does not contain ${reference}` }, { status: 409 });
      }
      reference ||= order.reference;
      customer = order.customer;
      material = order.materialType || material;
      try { truckingCompany = (await lookupMcleodGateOrder(orderId, site.terminal, site.siteName)).carrierName || truckingCompany; }
      catch { /* Keep the company entered by staff if the yard lookup is incomplete. */ }
      if (direction === "pickup" && !destination && order.destination) {
        destination = order.destination;
      }
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
      trucking_company: truckingCompany || null,
      destination: direction === "pickup" ? destination || null : null,
      warehouse_location: location || null, comment_1: notes || null, verified: false,
    }).select("id").single();
    if (error?.code === "23505") return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save manual check-in" }, { status: 500 });
  }
}

async function PATCHHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id ?? "");
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? "");
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    if (body?.action === "checkout") {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode)) {
        return NextResponse.json({ ok: false, error: "Invalid check-out" }, { status: 400 });
      }
      const sb = database();
      const { data: row, error: lookupError } = await sb.from("inbound_checkin_rows")
        .select("*")
        .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
        .in("material_type", ["cotton", "lumber", "other"]).maybeSingle();
      if (lookupError) throw lookupError;
      if (!row || !["waiting", "called", "in_door", "working"].includes(row.yard_status) || !row.checked_in_at) {
        return NextResponse.json({ ok: false, error: "This arrival has already changed. Refresh the line." }, { status: 409 });
      }
      const departure = new Date();
      let mcleod = "no linked order";
      if (row.material_type === "cotton" && row.movement_direction === "delivery" &&
          !["processed", "outside_carrier", "delivery_blocked"].includes(row.draft_status)) {
        const cotton = body?.cotton;
        if (!cotton || body.expectedUpdatedAt !== row.updated_at ||
            !["checked_in", "ready", "failed"].includes(row.draft_status)) {
          return NextResponse.json({ ok: false, error: "This cotton row changed. Refresh before finishing it." }, { status: 409 });
        }
        const baleCount = Number(cotton.baleCount);
        const bolBC = Number(cotton.bolBC);
        const location = String(cotton.warehouseLocation ?? "").trim().toUpperCase().slice(0, 120);
        const equipment = String(cotton.equipmentType ?? "").trim().toUpperCase();
        const mark = String(cotton.mark ?? "").trim().toUpperCase().slice(0, 120);
        const customer = String(cotton.customer ?? "").trim().toUpperCase().slice(0, 200);
        const ready = { ...row, mark, shipper: customer, bol_bc: bolBC, bale_count: baleCount,
          warehouse_location: location, equipment_type: equipment };
        if (!Number.isSafeInteger(baleCount) || !Number.isSafeInteger(bolBC) ||
            !["V", "F"].includes(equipment) || !isCompleteCheckin(ready)) {
          return NextResponse.json({ ok: false, error: "Enter the mark, customer, BOL count, unloaded bales, equipment, and warehouse location." }, { status: 400 });
        }
        const shortage = cottonShortage(ready);
        let acknowledgement = {};
        if (shortage && !shortageAcknowledged(ready)) {
          if (cotton.acknowledgeShortage !== true) return NextResponse.json({ ok: false, error: "Acknowledge the bale shortage with a note before finishing receiving. McLeod delivery cannot be posted." }, { status: 400 });
          try { acknowledgement = acknowledgeShortage(ready, cotton.shortageNote, user(req), departure.toISOString()); }
          catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
        }
        const { data: prepared, error: prepareError } = await sb.from("inbound_checkin_rows")
          .update({ mark, shipper: customer, bol_bc: bolBC, bale_count: baleCount,
            warehouse_location: location, equipment_type: equipment, verified: true,
            verified_at: departure.toISOString(), draft_status: shortage ? "delivery_blocked" : "ready", processing_error: null, ...acknowledgement,
            ...(shortage && cotton.shortageNote ? { comment_1: [row.comment_1, `Shortage acknowledged: ${shortage.received} of ${shortage.expected} bales. ${String(cotton.shortageNote).trim()}`].filter(Boolean).join("\n") } : {}) })
          .eq("id", id).eq("updated_at", row.updated_at)
          .in("draft_status", ["checked_in", "ready", "failed"]).select("*").maybeSingle();
        if (prepareError) throw prepareError;
        if (!prepared) return NextResponse.json({ ok: false, error: "This cotton row changed. Refresh before finishing it." }, { status: 409 });
        const processed = shortage ? prepared : await processCheckinRow(req, id);
        if (!processed || !["processed", "outside_carrier", "delivery_blocked"].includes(processed.draft_status)) {
          return NextResponse.json({ ok: false, error: processed?.processing_error || "Cotton delivery was not completed in McLeod. Check-in remains in the line." }, { status: 409 });
        }
        mcleod = processed.draft_status === "delivery_blocked" ? "receiving complete; bale shortage blocks McLeod delivery — notify the customer" : processed.draft_status === "processed" ? "cotton delivery processed" : "outside carrier; no McLeod delivery";
        // The database completes the yard status atomically with an SCM cotton delivery.
        if (processed.yard_status === "completed") {
          return NextResponse.json({ ok: true, row: { id, yard_status: processed.yard_status,
            yard_completed_at: processed.yard_completed_at }, mcleod });
        }
      } else if (row.material_type === "cotton" && row.movement_direction === "delivery") {
        mcleod = row.draft_status === "delivery_blocked" ? "receiving complete; bale shortage blocks McLeod delivery — notify the customer" : row.draft_status === "processed" ? "cotton delivery already processed" : "outside carrier; no McLeod delivery";
      } else if (row.matched_order_id) {
        if (process.env.MCLEOD_SYNC_ENABLED !== "true") {
          return NextResponse.json({ ok: false, error: "McLeod writes are disabled. Check-out was not saved." }, { status: 503 });
        }
        const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode)!;
        const order = await lookupMcleodGateOrder(row.matched_order_id, site.terminal, site.siteName);
        if (row.movement_direction !== order.direction || !order.stopId) {
          return NextResponse.json({ ok: false, error: "Could not confirm the matching McLeod stop. Check-out was not saved." }, { status: 409 });
        }
        if (!order.actualDeparture) {
          const base = process.env.MCLEOD_BASE_URL?.replace(/\/+$/, "");
          const token = process.env.MCLEOD_AUTH_TOKEN;
          if (!base || !token) throw new Error("McLeod connection is not configured");
          const checkedInAt = new Date(row.checked_in_at);
          let arrival = order.actualArrival || formatWarehouseTime(checkedInAt, site.terminal);
          let departureDate = formatWarehouseTime(departure, site.terminal);
          if (order.direction === "delivery") {
            const plan = planLiveDeliveryActuals({ receivedDate: warehouseDate(checkedInAt, site.terminal),
              terminal: site.terminal, checkedInAt, verifiedAt: departure, pickups: order.pickupStops,
              delivery: { id: order.stopId, actual_arrival: order.actualArrival, actual_departure: order.actualDeparture } });
            if (!plan.pickup.skipped) {
              const pickupParameters = new URLSearchParams({ arrivalDate: plan.pickup.arrivalDate, departureDate: plan.pickup.departureDate });
              const pickupResponse = await fetch(`${base}/carrierDispatch/clearStop/${encodeURIComponent(plan.pickup.stopId)}?${pickupParameters}`, {
                method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" }, cache: "no-store",
              });
              if (!pickupResponse.ok) throw new Error(`McLeod did not save the missing pickup actuals (${pickupResponse.status}). Delivery and check-out were not saved.`);
            }
            arrival = plan.delivery.arrivalDate;
            departureDate = plan.delivery.departureDate;
          }
          const parameters = new URLSearchParams({ arrivalDate: arrival, departureDate });
          const response = await fetch(`${base}/carrierDispatch/clearStop/${encodeURIComponent(order.stopId)}?${parameters}`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" }, cache: "no-store",
          });
          if (!response.ok) throw new Error(`McLeod did not save the stop departure (${response.status}). Check-out was not saved.`);
          mcleod = "departure sent to McLeod";
        } else {
          mcleod = "McLeod departure already recorded";
        }
      }
      const { data, error } = await sb.from("inbound_checkin_rows")
        .update({ yard_status: "completed", yard_completed_at: departure.toISOString(), yard_updated_by: user(req) })
        .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).eq("yard_status", row.yard_status)
        .select("id,yard_status,yard_completed_at").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "McLeod may have updated, but this line changed. Refresh and check its status." }, { status: 409 });
      return NextResponse.json({ ok: true, row: data, mcleod });
    }
    if (body?.action === "set_customer" || body?.action === "match_order" || body?.action === "edit_field") {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode) || !body.expectedUpdatedAt) {
        return NextResponse.json({ ok: false, error: "Invalid check-in update" }, { status: 400 });
      }
      const sb = database();
      const { data: existing, error: lookupError } = await sb.from("inbound_checkin_rows")
        .select("id,updated_at,reference_number,movement_direction,matched_order_id,destination")
        .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
        .in("material_type", ["lumber", "other"]).single();
      if (lookupError || !existing) return NextResponse.json({ ok: false, error: "Check-in not found" }, { status: 404 });
      if (existing.updated_at !== body.expectedUpdatedAt) return NextResponse.json({ ok: false, error: "This row changed. Refresh before saving." }, { status: 409 });
      if (body.action === "edit_field") {
        const field = String(body.field ?? "");
        if (!["reference_number", "warehouse_location", "comment_1", "driver_name", "driver_phone", "trucking_company"].includes(field)) {
          return NextResponse.json({ ok: false, error: "Invalid sheet field" }, { status: 400 });
        }
        const value = String(body.value ?? "").trim();
        const normalized = ["driver_name", "driver_phone", "trucking_company", "comment_1"].includes(field) ? value : value.toUpperCase();
        const maxLength = field === "driver_name" ? 120 : field === "driver_phone" ? 40 : field === "comment_1" ? 500 : 200;
        if ((field === "reference_number" && !normalized) || normalized.length > maxLength) {
          return NextResponse.json({ ok: false, error: "Enter a valid value" }, { status: 400 });
        }
        const changedReference = field === "reference_number" && normalized !== existing.reference_number;
        const updates = { [field]: normalized || null,
          ...(changedReference && existing.matched_order_id ? { matched_order_id: null, shipper: null } : {}) };
        const { data, error } = await sb.from("inbound_checkin_rows").update(updates)
          .eq("id", id).eq("updated_at", body.expectedUpdatedAt)
        .select("id,updated_at,reference_number,warehouse_location,comment_1,driver_name,driver_phone,trucking_company,shipper,matched_order_id").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ ok: false, error: "This row changed. Refresh before saving." }, { status: 409 });
        return NextResponse.json({ ok: true, row: data });
      }
      let customer = String(body.customer ?? "").trim().toUpperCase();
      let orderId: string | null = null;
      let canonicalReference: string | null = null;
      let matchedDestination: string | null = null;
      let matchedMaterial: string | null = null;
      let matchedCarrier: string | null = null;
      if (body.action === "match_order") {
        orderId = String(body.orderId ?? "").trim();
        const order = await lookupMcleodOrderById(orderId, existing.movement_direction);
        const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode)!;
        const yardOrder = await lookupMcleodGateOrder(orderId, site.terminal, site.siteName);
        if (yardOrder.completion) return NextResponse.json({ ok: false,
          error: yardOrder.completion.message, completion: yardOrder.completion }, { status: 409 });
        if (yardOrder.direction !== existing.movement_direction) return NextResponse.json({ ok: false, error: "This order belongs to a different move at this yard" }, { status: 409 });
        if (order.materialType === "cotton") return NextResponse.json({ ok: false, error: "Use the Cotton grid for this order" }, { status: 409 });
        const reference = String(existing.reference_number ?? "").trim().toUpperCase();
        if (!reference || !order.reference.includes(reference)) {
          return NextResponse.json({ ok: false, error: "That order does not contain the driver's reference in the required field" }, { status: 409 });
        }
        customer = order.customer;
        canonicalReference = order.reference;
        matchedDestination = existing.movement_direction === "pickup" && !existing.destination ? order.destination : null;
        matchedMaterial = order.materialType;
        matchedCarrier = yardOrder.carrierName || null;
      }
      if (!customer || customer.length > 200) return NextResponse.json({ ok: false, error: "Enter a customer" }, { status: 400 });
      const { data, error } = await sb.from("inbound_checkin_rows")
        .update({ shipper: customer, matched_order_id: orderId,
          ...(canonicalReference ? { reference_number: canonicalReference } : {}),
          ...(matchedDestination ? { destination: matchedDestination } : {}),
          ...(matchedMaterial ? { material_type: matchedMaterial } : {}),
          ...(matchedCarrier ? { trucking_company: matchedCarrier } : {}) })
        .eq("id", id).eq("updated_at", body.expectedUpdatedAt)
        .select("id,updated_at,shipper,matched_order_id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ ok: false, error: "This row changed. Refresh before saving." }, { status: 409 });
      return NextResponse.json({ ok: true, row: data });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode) || !NEXT[from]?.includes(to)) {
      return NextResponse.json({ ok: false, error: "Invalid queue transition" }, { status: 400 });
    }
    if (to === "completed") return NextResponse.json({ ok: false, error: "Use check-out to finish receiving" }, { status: 400 });
    const now = new Date().toISOString();
    const { data, error } = await database().from("inbound_checkin_rows")
      .update({ yard_status: to, [TIMESTAMP[to]]: now, yard_updated_by: user(req) })
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
      .in("material_type", ["cotton", "lumber", "other"]).eq("yard_status", from)
      .select("id,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "This arrival changed. Refresh the queue." }, { status: 409 });
    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Could not update domestic queue") }, { status: 500 });
  }
}

export const GET = withStaffAccess(GETHandler);
export const POST = withStaffAccess(POSTHandler);
export const PATCH = withStaffAccess(PATCHHandler);
