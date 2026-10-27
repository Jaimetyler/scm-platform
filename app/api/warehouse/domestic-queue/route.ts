import { randomUUID } from "node:crypto";
import { configuredLocalReceiving } from "@/lib/inbound/checkin/local-receiving";
import { outsideCarrierOverrideEligible, canPrepareMcleodLookup } from "@/lib/inbound/checkin/lookup-failure";
import { DependencyError, dependencyFetch } from "@/lib/http/dependency";
import { YardStopError } from "@/lib/inbound/checkin/yard-stop";
import { withStaffAccess, staffActor, staffProfile } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { warehouseDate } from "@/lib/inbound/checkin/geofence";
import { lookupMcleodGateOrder } from "@/lib/inbound/checkin/mcleod-order-id";
import { referenceMatchesInput } from "@/lib/inbound/checkin/reference-match";
import { resolveCustomer } from "@/lib/mcleod/inbound/resolveCustomer";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import { formatWarehouseTime, planLiveDeliveryActuals } from "@/lib/inbound/checkin/mcleod-time";
import { isCompleteCheckin } from "@/lib/inbound/checkin/ready";
import { processCheckinRow } from "@/lib/inbound/checkin/process-row";
import { enrichDisplayCarriers } from "@/lib/inbound/checkin/display-carrier";

import { cottonShortage, shortageAcknowledged, acknowledgeShortage } from "@/lib/inbound/checkin/shortage";

export const runtime = "nodejs";
const QUEUE_FIELDS = "id,terminal,site_name,checkin_source,updated_at,checked_in_at,physical_departed_at,local_receiving_only,driver_name,driver_phone,trucking_company,movement_direction,material_type,reference_number,destination,shipper,matched_order_id,warehouse_location,equipment_type,comment_1,mark,bol_bc,bale_count,expected_bale_count,driver_reported_bales,shortage_acknowledged_at,shortage_acknowledged_by,shortage_expected_bales,shortage_received_bales,shortage_note,customer_notified_at,customer_notified_by,draft_status,bol_photo_path,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at,site_code,matched_stop_id,mcleod_lookup_status,mcleod_lookup_attempt_id,mcleod_lookup_failure_code,mcleod_lookup_failed_at,mcleod_lookup_has_known_match,mcleod_processing_phase,processing_error,outside_carrier_override_at,outside_carrier_override_by,outside_carrier_override_reason";
function queueRow(row: Record<string, any>) {
  return { ...Object.fromEntries(QUEUE_FIELDS.split(",").filter(key => key !== "bol_photo_path")
      .map(key => [key, row[key]])),
    has_bol_photo: Boolean(row.bol_photo_path),
    outside_carrier_override_eligible: outsideCarrierOverrideEligible(row),
    lookup_prepare_eligible: canPrepareMcleodLookup(row),
    lookup_retry_eligible: row.draft_status === "processing" && row.mcleod_processing_phase === "lookup" &&
      ["pending", "searching", "unresolved", "conflict", "error"].includes(row.mcleod_lookup_status) && Boolean(row.mcleod_lookup_attempt_id) &&
      !row.outside_carrier_override_at && !row.matched_order_id && !row.matched_stop_id };
}

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
  return createClient(url, key, { global: { fetch: dependencyFetch } });
}

function siteExists(terminal: string, siteCode: string) {
  return CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode);
}

function user(req: NextRequest) { return staffActor(req); }

// Supabase resolves transport failures as plain error results (status 0), so
// instanceof checks alone cannot distinguish them from database conflicts.
function databaseFailure(result: { error?: any; status?: number }, uncertain = false) {
  const code = String(result.error?.code ?? "");
  const unavailable = result.status === 0 || result.status === 408 || result.status === 429 ||
    Number(result.status) >= 500 || ["57014", "53300", "57P01", "57P02", "57P03"].includes(code) || code.startsWith("08") ||
    /^(DependencyError|AbortError|TimeoutError|FetchError):/.test(String(result.error?.message ?? ""));
  if (unavailable) return NextResponse.json({ ok: false, code: "DEPENDENCY_UNAVAILABLE",
    error: uncertain ? "The saved checkout status could not be confirmed. It may already have completed. Refresh saved status or retry this same confirmation."
      : "Saved status is temporarily unavailable. Please try again." },
    { status: 503, headers: { "Retry-After": "10", "Cache-Control": "no-store" } });
  const status = code === "42501" ? 403 : code === "22023" ? 400 : code === "P0002" ? 404 : code === "40001" ? 409 : 500;
  return NextResponse.json({ ok: false, code: status === 409 ? "CHECKOUT_CONFLICT" : "CHECKOUT_UNAVAILABLE",
    error: status === 409 ? "This arrival changed. Refresh saved status before taking another action."
      : status === 403 ? "Active staff access for this yard is required." : status === 404 ? "This arrival is no longer available in this yard."
      : status === 400 ? "Refresh saved status and check the confirmation details." : "Saved status could not be confirmed. Refresh saved status before taking another action." }, { status });
}

async function GETHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const terminal = String(searchParams.get("terminal") ?? "").toUpperCase();
    const siteCode = String(searchParams.get("siteCode") ?? "");
    if (!siteExists(terminal, siteCode)) return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });

    // An exact scoped read avoids the active-line date/row limits and performs
    // no carrier enrichment or McLeod calls during uncertain-write recovery.
    if (searchParams.has("id")) {
      const id = searchParams.get("id") || "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return NextResponse.json({ ok: false, error: "Invalid arrival identifier" }, { status: 400 });
      const result = await database().from("inbound_checkin_rows").select(QUEUE_FIELDS)
        .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
        .in("material_type", ["cotton", "lumber", "other"]).maybeSingle();
      if (result.error) return databaseFailure(result);
      if (!result.data) return NextResponse.json({ ok: false, error: "This arrival is no longer available in this yard." }, { status: 404 });
      return NextResponse.json({ ok: true, row: queueRow(result.data) }, { headers: { "Cache-Control": "no-store" } });
    }
    const line = searchParams.get("view") === "line";
    const { data, error } = await database().from("inbound_checkin_rows")
      .select(QUEUE_FIELDS)
      .eq("terminal", terminal).eq("site_code", siteCode)
      .in("material_type", line ? ["cotton", "lumber", "other"] : ["lumber", "other"])
      .gte("checked_in_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("checked_in_at", { ascending: false }).limit(line ? 500 : 200);
    if (error) throw error;
    const displayRows = await enrichDisplayCarriers(data ?? [], line);
    return NextResponse.json({ ok: true, rows: displayRows.map(row => ({ ...queueRow(row), carrier_code: row.carrier_code, scm_carrier: row.scm_carrier })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Could not load domestic queue") }, { status: error instanceof DependencyError ? 503 : error instanceof YardStopError ? 409 : 500, headers: error instanceof DependencyError ? { "Retry-After": "10" } : {} });
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
    let matchedStopId: string | null = null;
    if (orderId) {
      const yardOrder = await lookupMcleodGateOrder(orderId, site.terminal, site.siteName, direction as "pickup" | "delivery", String(body.selectedStopId || "") || undefined);
      const order = yardOrder; matchedStopId = yardOrder.stopId;
      if (yardOrder.direction !== direction) return NextResponse.json({ ok: false, error: "This order belongs to a different move at this yard" }, { status: 409 });
      if (yardOrder.completion) {
        return NextResponse.json({ ok: false, error: yardOrder.completion.message, completion: yardOrder.completion }, { status: 409 });
      }
      if (order.materialType === "cotton") return NextResponse.json({ ok: false, error: "Use the Cotton grid for this order" }, { status: 409 });
      if (reference && !referenceMatchesInput(order.reference, reference)) {
        return NextResponse.json({ ok: false, error: `Order ${orderId} ${direction === "pickup" ? "BLNUM" : "consignee reference"} does not contain ${reference}` }, { status: 409 });
      }
      reference ||= order.reference;
      customer = order.customer;
      material = order.materialType || material;
      truckingCompany = yardOrder.carrierName || truckingCompany;
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
      shipper: customer || null, matched_order_id: orderId || null, matched_stop_id: matchedStopId,
      driver_name: driverName || null, driver_phone: driverPhone || null,
      trucking_company: truckingCompany || null,
      destination: direction === "pickup" ? destination || null : null,
      warehouse_location: location || null, comment_1: notes || null, verified: false,
    }).select("id").single();
    if (error?.code === "23505") return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save manual check-in" }, { status: error instanceof DependencyError ? 503 : error instanceof YardStopError ? 409 : 500, headers: error instanceof DependencyError ? { "Retry-After": "10" } : {} });
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
    if (body?.action === "process_outside_carrier") {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuid.test(id) || !siteExists(terminal, siteCode) ||
          !uuid.test(String(body.lookupAttemptId ?? "")) || !uuid.test(String(body.requestId ?? "")) ||
          typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)) ||
          body.acknowledgeUnresolved !== true) {
        return NextResponse.json({ ok: false, error: "Confirm the completed movement with unresolved McLeod verification using the current arrival and lookup attempt." }, { status: 400 });
      }
      const staff = staffProfile(req);
      if (!staff || !["admin", "operator"].includes(staff.role) || !staff.user_id ||
          staff.role === "operator" && staff.terminal !== terminal) {
        return NextResponse.json({ ok: false, error: "Active staff access for this yard is required." }, { status: 403 });
      }
      const db = database();
      // The server supplies new audit text; client prose cannot assert verification.
      // An exact replay may predate this UI. Preserve its immutable saved reason
      // so the existing atomic RPC can validate and return the original result.
      const replay = await db.from("inbound_outside_carrier_events")
        .select("reason").eq("checkin_id", id).eq("request_id", body.requestId)
        .eq("lookup_attempt_id", body.lookupAttemptId).eq("actor_id", staff.id)
        .eq("actor_user_id", staff.user_id).maybeSingle();
      if (replay.error) return databaseFailure(replay, true);
      const reason = replay.data?.reason ?? "Staff confirmed physical movement completed as outside carrier; McLeod verification remains unresolved; no McLeod update.";
      const result = await db.rpc("complete_inbound_outside_carrier", {
        p_id: id, p_terminal: terminal, p_site_code: siteCode,
        p_expected_updated_at: body.expectedUpdatedAt, p_lookup_attempt_id: body.lookupAttemptId,
        p_request_id: body.requestId, p_staff_id: staff.id, p_user_id: staff.user_id,
        p_acknowledge_unresolved: true, p_reason: reason,
      });
      if (result.error) return databaseFailure(result, true);
      const completed = result.data?.[0];
      if (!completed) return NextResponse.json({ ok: false, error: "This arrival changed. Refresh the line." }, { status: 409 });
      return NextResponse.json({ ok: true, row: queueRow(completed),
        mcleod: "outside carrier; McLeod verification unresolved; no McLeod delivery" });
    }
    if (body?.action === "retry_lookup") {
      const staff = staffProfile(req);
      if (!staff || !["admin", "operator"].includes(staff.role) || !staff.user_id ||
          staff.role === "operator" && staff.terminal !== terminal) {
        return NextResponse.json({ ok: false, error: "Active staff access for this yard is required." }, { status: 403 });
      }
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode) ||
          typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
        return NextResponse.json({ ok: false, error: "Refresh before retrying this lookup." }, { status: 400 });
      }
      const { data, error } = await database().rpc("retry_inbound_checkin_lookup", {
        p_id: id, p_terminal: terminal, p_site_code: siteCode, p_expected_updated_at: body.expectedUpdatedAt,
        p_staff_id: staff.id, p_user_id: staff.user_id,
      });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "42501" ? 403 : 409 });
      if (!data?.[0]) return NextResponse.json({ ok: false, error: "This lookup changed. Refresh the line." }, { status: 409 });
      const processed = await processCheckinRow(req, id, data[0]);
      const eligible = outsideCarrierOverrideEligible(processed);
      const ok = ["processed", "outside_carrier"].includes(processed?.draft_status) && processed.yard_status === "completed";
      return NextResponse.json({ ok, row: queueRow(processed),
        ...(ok ? { mcleod: processed.draft_status === "outside_carrier" ? "outside carrier; no McLeod delivery" : "cotton delivery processed" }
          : { error: processed?.processing_error || "The lookup has not completed. Refresh the line.",
            ...(eligible ? { code: "MCLEOD_LOOKUP_UNRESOLVED", outsideCarrierEligible: true } : {}) }) }, { status: ok ? 200 : 409 });
    }
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
      // Finish cotton is the staff completion action. A stable operation ID is
      // retained through lookup and fallback; incomplete lookup is never no-match.
      const finishRequestId = body.finishCottonRequestId;
      const automaticFallback = finishRequestId !== undefined;
      const finishStaff = automaticFallback ? staffProfile(req) : null;
      if (automaticFallback && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(finishRequestId)) ||
          row?.material_type !== "cotton" || row?.movement_direction !== "delivery"))
        return NextResponse.json({ ok: false, error: "Invalid cotton completion request" }, { status: 400 });
      if (automaticFallback && (!finishStaff || !["admin", "operator"].includes(finishStaff.role) || !finishStaff.user_id ||
          finishStaff.role === "operator" && finishStaff.terminal !== terminal))
        return NextResponse.json({ ok: false, error: "Active staff access for this yard is required." }, { status: 403 });
      // An already completed local visit is a successful, read-only checkout.
      // Do not repeat a McLeod write or change its original departure timestamp.
      // Still require a valid yard-scoped row and staff authorization above.
      if (row?.yard_status === "completed")
        return NextResponse.json({ ok: true, row: queueRow(row),
          mcleod: "already completed; saved status refreshed" });
      // Local-only customer receipts are never sent to McLeod. The receiving
      // screen already records physical departure when all details are saved.
      if (row?.local_receiving_only === true && !row.matched_order_id && !body?.cotton) {
        if (!row.physical_departed_at) return NextResponse.json({ ok: false,
          error: "Complete and save receiving details before checking out this local-only load." }, { status: 409 });
        const { data: localDone, error: localError } = await sb.from("inbound_checkin_rows")
          .update({ yard_status: "completed", yard_completed_at: row.physical_departed_at,
            yard_updated_by: user(req) })
          .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
          .eq("yard_status", row.yard_status).eq("updated_at", row.updated_at)
          .select("*").maybeSingle();
        if (localError) throw localError;
        if (!localDone) return NextResponse.json({ ok: false,
          error: "This arrival changed. Refresh saved status." }, { status: 409 });
        return NextResponse.json({ ok: true, row: queueRow(localDone),
          mcleod: "Local-only receiving complete; no McLeod update." });
      }
      if (!row || !["waiting", "called", "in_door", "working"].includes(row.yard_status) || !row.checked_in_at) {
        return NextResponse.json({ ok: false, error: "This arrival has already changed. Refresh the line." }, { status: 409 });
      }
      if (row.mcleod_processing_phase === "write_pending") {
        return NextResponse.json({ ok: false, error: "A McLeod write may already have happened. Reconcile it before retrying check-out.",
          code: "MCLEOD_WRITE_UNCERTAIN", row: queueRow(row) }, { status: 409 });
      }
      async function completeFallback(candidate: any) {
        if (!automaticFallback || !finishStaff || !outsideCarrierOverrideEligible(candidate)) return null;
        const result = await sb.rpc("complete_inbound_outside_carrier_auto", {
          p_id: id, p_terminal: terminal, p_site_code: siteCode,
          p_expected_updated_at: candidate.updated_at, p_lookup_attempt_id: candidate.mcleod_lookup_attempt_id,
          p_request_id: finishRequestId, p_staff_id: finishStaff.id, p_user_id: finishStaff.user_id,
        });
        if (result.error) return databaseFailure(result, true);
        const saved = result.data?.[0];
        if (!saved || saved.yard_status !== "completed") return NextResponse.json({ ok: false,
          code: "CHECKOUT_UNCERTAIN", error: "Refresh saved status before taking another action." }, { status: 503 });
        return NextResponse.json({ ok: true, row: queueRow(saved),
          mcleod: "outside carrier; SCM verification unresolved; no McLeod update" });
      }
      const departure = new Date();
      // For non-cotton movements, persist physical departure before any
      // fallible McLeod lookup/write. The yard board uses this independent
      // marker, while the remote integration retains its reconciliation state.
      if (row.material_type !== "cotton" && !row.physical_departed_at) {
        const { data: departed, error: departureError } = await sb.from("inbound_checkin_rows")
          .update({ physical_departed_at: departure.toISOString(), yard_updated_by: user(req) })
          .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
          .eq("updated_at", row.updated_at).is("physical_departed_at", null)
          .select("updated_at,physical_departed_at").maybeSingle();
        if (departureError) throw departureError;
        if (!departed) return NextResponse.json({ ok: false,
          error: "This arrival changed. Refresh saved status before checking out." }, { status: 409 });
        row.updated_at = departed.updated_at;
        row.physical_departed_at = departed.physical_departed_at;
      }
      let mcleod = "no linked order";
      let nonCottonWriteAttempt: string | null = null;
      // Persist one versioned write claim before the first vendor mutation.
      // A timeout/HTTP failure leaves write_pending fenced for reconciliation.
      async function claimNonCottonWrite() {
        if (nonCottonWriteAttempt) return;
        const attempt = randomUUID();
        const { data: claimed, error } = await sb.from("inbound_checkin_rows")
          .update({ draft_status: "processing", mcleod_lookup_attempt_id: attempt,
            mcleod_processing_phase: "write_pending", mcleod_lookup_status: "matched" })
          .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
          .eq("updated_at", row.updated_at).eq("yard_status", row.yard_status)
          .in("draft_status", ["checked_in", "ready"])
          .select("*").maybeSingle();
        if (error) throw error;
        if (!claimed) throw new Error("Checkout changed before the McLeod write. Refresh saved status; do not retry blindly.");
        nonCottonWriteAttempt = attempt;
        row.updated_at = claimed.updated_at;
      }
      // A previously completed McLeod stop must never be written again. The
      // database RPC makes warehouse completion, inventory receipt and audit atomic.
      async function reconcileAlreadyCompleted(checked: any, saved: any, discoveredOrderId?: string) {
        const staff = staffProfile(req);
        if (!staff || !["admin", "operator"].includes(staff.role) || !staff.user_id ||
            staff.role === "operator" && staff.terminal !== terminal) {
          return NextResponse.json({ ok: false, error: "Active warehouse operator access required" }, { status: 403 });
        }
        if (checked.direction !== saved.movement_direction || !checked.stopId ||
            (saved.matched_stop_id && String(saved.matched_stop_id) !== checked.stopId) ||
            !checked.actualArrival || !checked.actualDeparture ||
            checked.completion?.kind === "cancelled" ||
            (checked.materialType && checked.materialType !== saved.material_type)) {
          return NextResponse.json({ ok: false, error: "The completed McLeod stop, material, or arrival/departure could not be verified. Review before closing SCM." }, { status: 409 });
        }
        if (saved.material_type === "cotton") {
          const expectedMark = String(saved.mark ?? "").trim().toUpperCase();
          if (!expectedMark || expectedMark !== String(checked.mark ?? "").trim().toUpperCase() ||
              !Number.isSafeInteger(Number(saved.bale_count)) || Number(saved.bale_count) <= 0 ||
              checked.baleCount && Number(checked.baleCount) !== Number(saved.bale_count) ||
              !String(saved.shipper ?? "").trim() || !String(checked.customer ?? "").trim() ||
              resolveCustomer(String(saved.shipper)).canonicalCustomer !== resolveCustomer(String(checked.customer)).canonicalCustomer) {
            return NextResponse.json({ ok: false, error: "McLeod mark, bale count, or customer conflicts with receiving. Review before closing SCM." }, { status: 409 });
          }
        } else if (!String(saved.reference_number ?? "").trim() ||
                   !referenceMatchesInput(checked.reference, saved.reference_number)) {
          return NextResponse.json({ ok: false, error: "McLeod reference differs from this yard arrival. Review before closing SCM." }, { status: 409 });
        }
        if (discoveredOrderId) {
          if (saved.matched_order_id || saved.matched_stop_id || saved.mcleod_processing_phase !== "lookup" ||
              saved.draft_status !== "failed") return NextResponse.json({ ok: false,
            error: "Saved match or processing state changed; refresh before reconciliation." }, { status: 409 });
          const bound = await sb.from("inbound_checkin_rows")
            .update({ matched_order_id: discoveredOrderId, matched_stop_id: checked.stopId,
              mcleod_lookup_has_known_match: true })
            .eq("id", id).eq("updated_at", saved.updated_at).eq("draft_status", "failed")
            .eq("mcleod_processing_phase", "lookup").select("*").maybeSingle();
          if (bound.error) return databaseFailure(bound, true);
          if (!bound.data) return NextResponse.json({ ok: false,
            error: "Arrival changed during completed-order verification. Refresh the line." }, { status: 409 });
          saved = bound.data;
        }
        const result = await sb.rpc("complete_inbound_mcleod_already_done", {
          p_id: id, p_terminal: terminal, p_site_code: siteCode,
          p_expected_updated_at: saved.updated_at, p_order_id: String(saved.matched_order_id),
          p_stop_id: checked.stopId, p_staff_id: staff.id, p_user_id: staff.user_id,
          p_mcleod_arrival: checked.actualArrival, p_mcleod_departure: checked.actualDeparture,
        });
        if (result.error) return databaseFailure(result, true);
        const done = result.data?.[0];
        if (!done || done.yard_status !== "completed") return NextResponse.json({ ok: false,
          error: "Completion status is uncertain. Refresh the line before retrying.", code: "CHECKOUT_UNCERTAIN" }, { status: 503 });
        return NextResponse.json({ ok: true, row: queueRow(done),
          mcleod: "McLeod stop already completed; SCM warehouse/yard reconciled without McLeod write" });
      }

      if (row.material_type === "cotton" && row.movement_direction === "delivery" &&
          !["processed", "outside_carrier", "delivery_blocked"].includes(row.draft_status)) {
        if (!canPrepareMcleodLookup(row)) return NextResponse.json({ ok: false,
          error: "This older processing outcome needs review before another lookup or outside-carrier completion.",
          code: "MCLEOD_LEGACY_REVIEW_REQUIRED", row: queueRow(row) }, { status: 409 });
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
        const localOnly = !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match &&
          (row.local_receiving_only === true || configuredLocalReceiving({ ...row, shipper: customer }));
        let acknowledgement = {};
        if (shortage && !shortageAcknowledged(ready)) {
          if (cotton.acknowledgeShortage !== true) return NextResponse.json({ ok: false, error: "Acknowledge the bale shortage with a note before finishing receiving. McLeod delivery cannot be posted." }, { status: 400 });
          try { acknowledgement = acknowledgeShortage(ready, cotton.shortageNote, user(req), departure.toISOString()); }
          catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
        }
        const { data: prepared, error: prepareError } = await sb.from("inbound_checkin_rows")
          .update({ mark, shipper: customer, bol_bc: bolBC, bale_count: baleCount,
            warehouse_location: location, equipment_type: equipment, verified: true,
            verified_at: departure.toISOString(), draft_status: shortage ? "delivery_blocked" : localOnly ? "checked_in" : "ready", processing_error: null,
            ...(localOnly ? { local_receiving_only: true, physical_departed_at: row.physical_departed_at || departure.toISOString(),
              yard_status: "completed", yard_completed_at: row.yard_completed_at || departure.toISOString(), yard_updated_by: user(req) }
              : !shortage ? { mcleod_processing_phase: "lookup" } : {}), ...acknowledgement,
            ...(shortage && cotton.shortageNote ? { comment_1: [row.comment_1, `Shortage acknowledged: ${shortage.received} of ${shortage.expected} bales. ${String(cotton.shortageNote).trim()}`].filter(Boolean).join("\n") } : {}) })
          .eq("id", id).eq("updated_at", row.updated_at)
          .in("draft_status", ["checked_in", "ready", "failed"]).select("*").maybeSingle();
        if (prepareError) throw prepareError;
        if (!prepared) return NextResponse.json({ ok: false, error: "This cotton row changed. Refresh before finishing it." }, { status: 409 });
        if (localOnly) return NextResponse.json({ ok: true, row: queueRow(prepared),
          mcleod: shortage ? "Local receiving complete; shortage acknowledged. No McLeod update." : "Local receiving complete; no McLeod update." });
        // Reconcile a closed SCM delivery before the regular live-sync path,
        // which correctly forbids posting already-delivered stop actuals.
        if (!shortage && prepared.matched_order_id) {
          const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode)!;
          let verifiedOrder: Awaited<ReturnType<typeof lookupMcleodGateOrder>>;
          try {
            verifiedOrder = await lookupMcleodGateOrder(String(prepared.matched_order_id), site.terminal,
              site.siteName, "delivery", prepared.matched_stop_id);
          } catch (error) {
            return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "McLeod verification unavailable",
              row: queueRow(prepared) }, { status: 409 });
          }
          if (verifiedOrder.actualDeparture || verifiedOrder.completion) {
            if (!verifiedOrder.actualArrival || !verifiedOrder.actualDeparture)
              return NextResponse.json({ ok: false,
                error: "McLeod says completed but the selected delivery stop lacks both actual timestamps. Staff review required.",
                row: queueRow(prepared) }, { status: 409 });
            return reconcileAlreadyCompleted(verifiedOrder, prepared);
          }
        }
        const processed = shortage ? prepared : await processCheckinRow(req, id);
        if (!processed || !["processed", "outside_carrier", "delivery_blocked"].includes(processed.draft_status)) {
          // A completed delivery can be discovered by mark but excluded from
          // open-order sync. Verify it afresh and use the SCM-only audited RPC;
          // never clear known-match evidence or convert it to outside-carrier.
          if (processed?.processing_error === "The saved McLeod match was not found. Review it before completing receiving." &&
              !processed.matched_order_id && !processed.matched_stop_id &&
              processed.mcleod_processing_phase === "lookup") {
            try {
              const [candidate] = await buildPreview([{ source: "live_checkin", terminal: processed.terminal,
                receivedDate: processed.received_date, mark: processed.mark, shipper: processed.shipper,
                bolBC: String(processed.bol_bc ?? ""), balesUnloaded: processed.bale_count }],
                { strictSearch: true, includeCompletedForReconciliation: true });
              if (candidate?.status === "Matched" && candidate.candidateCount === 1 && candidate.matchedOrderId) {
                const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode)!;
                const checked = await lookupMcleodGateOrder(candidate.matchedOrderId, site.terminal, site.siteName, "delivery");
                if (checked.actualArrival && checked.actualDeparture)
                  return reconcileAlreadyCompleted(checked, processed, candidate.matchedOrderId);
              }
            } catch (error) {
              return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Completed McLeod order could not be verified",
                row: queueRow(processed) }, { status: 409 });
            }
          }
          const fallback = await completeFallback(processed);
          if (fallback) return fallback;
          const eligible = outsideCarrierOverrideEligible(processed);
          return NextResponse.json({ ok: false,
            error: processed?.processing_error || "Cotton delivery was not completed in McLeod. Check-in remains in the line.",
            ...(eligible ? { code: "MCLEOD_LOOKUP_UNRESOLVED", outsideCarrierEligible: true } : {}),
            ...(processed ? { row: queueRow(processed) } : {}) }, { status: 409 });
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
        const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode)!;
        const order = await lookupMcleodGateOrder(row.matched_order_id, site.terminal, site.siteName,
          row.movement_direction, row.matched_stop_id);
        if (row.movement_direction !== order.direction || !order.stopId) {
          return NextResponse.json({ ok: false, error: "Could not confirm the matching McLeod stop. Check-out was not saved." }, { status: 409 });
        }
        // A verified stop with an existing departure actual is already complete.
        // Never post a second clearStop or alter that McLeod timestamp.
        if (order.actualDeparture || order.completion) {
          if (!order.actualArrival || !order.actualDeparture)
            return NextResponse.json({ ok: false, error: "McLeod is closed without verified arrival and departure for the selected stop. Review required." }, { status: 409 });
          return reconcileAlreadyCompleted(order, row);
        }
        if (process.env.MCLEOD_SYNC_ENABLED !== "true") {
          return NextResponse.json({ ok: false, error: "McLeod writes are disabled. Check-out was not saved." }, { status: 503 });
        }
        if (!order.actualDeparture) {
          if (order.completion || !order.movementId ||
              (row.movement_direction === "delivery" && (!order.pickupMovementVerified || !order.pickupBackfillVerified)) ||
              order.materialType !== row.material_type || !String(row.reference_number ?? "").trim() ||
              !referenceMatchesInput(order.reference, row.reference_number)) {
            return NextResponse.json({ ok: false, error: "The saved order details or pickup prerequisites could not be verified. Review them before check-out." }, { status: 409 });
          }
          // Bind legacy unique matches before any write. A persisted selection must
          // never silently fall through to a different stop after remote edits.
          if (!row.matched_stop_id) {
            const { data: bound, error: bindError } = await sb.from("inbound_checkin_rows")
              .update({ matched_stop_id: order.stopId }).eq("id", id).eq("updated_at", row.updated_at)
              .select("updated_at").maybeSingle();
            if (bindError) throw bindError;
            if (!bound) return NextResponse.json({ ok: false, error: "This arrival changed. Refresh before check-out." }, { status: 409 });
            row.updated_at = bound.updated_at;
            row.matched_stop_id = order.stopId;
          }
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
              await claimNonCottonWrite();
              const pickupResponse = await fetch(`${base}/carrierDispatch/clearStop/${encodeURIComponent(plan.pickup.stopId)}?${pickupParameters}`, {
                method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" }, cache: "no-store",
              });
              if (!pickupResponse.ok) throw new Error(`McLeod pickup outcome is uncertain (${pickupResponse.status}). Refresh saved status and reconcile; do not retry the write.`);
            }
            arrival = plan.delivery.arrivalDate;
            departureDate = plan.delivery.departureDate;
          }
          const parameters = new URLSearchParams({ arrivalDate: arrival, departureDate });
          await claimNonCottonWrite();
          const response = await fetch(`${base}/carrierDispatch/clearStop/${encodeURIComponent(order.stopId)}?${parameters}`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" }, cache: "no-store",
          });
          if (!response.ok) throw new Error(`McLeod departure outcome is uncertain (${response.status}). Refresh saved status and reconcile; do not retry the write.`);
          mcleod = "departure sent to McLeod";
        } else {
          mcleod = order.direction === "delivery"
            ? "OK — Already delivered in McLeod. Truck checked out."
            : "OK — McLeod departure already recorded. Truck checked out.";
        }
      }
      let completion = sb.from("inbound_checkin_rows")
        .update({ yard_status: "completed", yard_completed_at: departure.toISOString(), yard_updated_by: user(req),
          ...(nonCottonWriteAttempt ? { draft_status: "processed", processed_at: departure.toISOString(),
            mcleod_processing_phase: "complete", mcleod_processing_result_id: nonCottonWriteAttempt } : {}) })
        .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode).eq("yard_status", row.yard_status);
      if (nonCottonWriteAttempt) completion = completion.eq("updated_at", row.updated_at)
        .eq("mcleod_lookup_attempt_id", nonCottonWriteAttempt).eq("mcleod_processing_phase", "write_pending");
      const { data, error } = await completion.select("id,yard_status,yard_completed_at").maybeSingle();
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
          ...(changedReference && existing.matched_order_id ? { matched_order_id: null, matched_stop_id: null, shipper: null } : {}) };
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
      let matchedStopId: string | null = null;
      if (body.action === "match_order") {
        orderId = String(body.orderId ?? "").trim();
        const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode)!;
        const yardOrder = await lookupMcleodGateOrder(orderId, site.terminal, site.siteName, existing.movement_direction, String(body.selectedStopId || "") || undefined);
        const order = yardOrder; matchedStopId = yardOrder.stopId;
        if (yardOrder.completion) return NextResponse.json({ ok: false,
          error: yardOrder.completion.message, completion: yardOrder.completion }, { status: 409 });
        if (yardOrder.direction !== existing.movement_direction) return NextResponse.json({ ok: false, error: "This order belongs to a different move at this yard" }, { status: 409 });
        if (order.materialType === "cotton") return NextResponse.json({ ok: false, error: "Use the Cotton grid for this order" }, { status: 409 });
        const reference = String(existing.reference_number ?? "").trim().toUpperCase();
        if (!reference || !referenceMatchesInput(order.reference, reference)) {
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
        .update({ shipper: customer, matched_order_id: orderId, matched_stop_id: matchedStopId,
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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "Could not update domestic queue") }, { status: error instanceof DependencyError ? 503 : error instanceof YardStopError ? 409 : 500, headers: error instanceof DependencyError ? { "Retry-After": "10" } : {} });
  }
}

export const GET = withStaffAccess(GETHandler);
export const POST = withStaffAccess(POSTHandler);
export const PATCH = withStaffAccess(PATCHHandler);
