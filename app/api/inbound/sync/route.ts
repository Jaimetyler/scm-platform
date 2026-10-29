import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dependencyFetch } from "@/lib/http/dependency";
import { McleodLookupIncompleteError } from "@/lib/inbound/checkin/lookup-failure";
import { withStaffAccess, staffProfile } from "@/lib/auth/guard";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { lookupMcleodGateOrder } from "@/lib/inbound/checkin/mcleod-order-id";
import { currentCottonOrder } from "@/lib/inbound/checkin/current-cotton-order";
import { NextRequest, NextResponse } from "next/server";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";
import { planLiveDeliveryActuals } from "@/lib/inbound/checkin/mcleod-time";
import { resolveCustomer } from "@/lib/mcleod/inbound/resolveCustomer";
import { expectedCustomerId, isOutsideCarrierNoMatch } from "@/lib/inbound/checkin/match-outcome";

export const runtime = "nodejs";

type SyncPreviewResult = {
  status?: string;
  matchedOrderId?: string;
  reason?: string;
  candidateCount?: number;
  resolvedCustomer?: { customerId?: string };
  parsedBlnum?: {
    raw?: string;
    mark?: string;
    count?: string;
  };
  [key: string]: unknown;
};

type McleodMovement = {
  id?: string;
  status?: string;
  brokerage_status?: string;
  [key: string]: unknown;
};

type McleodStop = {
  id?: string;
  stop_type?: string;
  status?: string;
  actual_arrival?: string | null;
  actual_departure?: string | null;
  [key: string]: unknown;
};

function isSyncEnabled() {
  return process.env.MCLEOD_SYNC_ENABLED === "true";
}

function getBaseUrl() {
  const baseUrl = process.env.MCLEOD_BASE_URL;
  if (!baseUrl) throw new Error("Missing MCLEOD_BASE_URL");
  return baseUrl.replace(/\/+$/, "");
}

function getHeaders(): HeadersInit {
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!token) throw new Error("Missing MCLEOD_AUTH_TOKEN");

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function normalizeText(v: unknown) {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).trim().replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function resolveBales(row: InboundExcelRow, preview: SyncPreviewResult): number | null {
  return (
    parseNum((row as any).balesUnloaded) ??
    parseNum((row as any).bolBC) ??
    parseNum(preview?.parsedBlnum?.count) ??
    null
  );
}

function resolveRowCustomer(row: InboundExcelRow) {
  return normalizeText(
    (row as any).customer ??
      (row as any).shipper ??
      (row as any).customerId ??
      (row as any).customer_id ??
      ""
  );
}

function resolveOrderCustomer(order: any) {
  const id = order.customer_id ?? order.customerId ?? order.customer?.id;
  return normalizeText(id ?? resolveCustomer(order.customer?.name).customerId);
}

function resolveRowMark(row: InboundExcelRow, preview: SyncPreviewResult) {
  return normalizeText(
    (row as any).mark ??
      (row as any).consignee_refno ??
      (row as any).consigneeRefno ??
      preview?.parsedBlnum?.mark ??
      ""
  );
}

function resolveOrderMark(order: any, preview: SyncPreviewResult) {
  return normalizeText(
    order.consignee_refno ??
      order.consigneeRefno ??
      preview?.parsedBlnum?.mark ??
      ""
  );
}

function resolveOrderBales(order: any, preview: SyncPreviewResult): number | null {
  return (
    parseNum(preview?.parsedBlnum?.count) ??
    parseNum(order.pieces) ??
    parseNum(order.pieces_count) ??
    parseNum(order.piece_count) ??
    parseNum(order.commodity?.pieces) ??
    null
  );
}

function hasActuals(stop: McleodStop | undefined) {
  return !!(stop?.actual_arrival && stop?.actual_departure);
}

async function getOrder(orderId: string) {
  const res = await dependencyFetch(`${getBaseUrl()}/orders/${orderId}`, {
    method: "GET",
    headers: getHeaders(),
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`GET failed ${res.status} ${text}`);
  }

  return JSON.parse(text);
}

async function clearCarrierStop(
  stopId: string,
  arrivalDate: string,
  departureDate: string
) {
  const qs = new URLSearchParams({
    arrivalDate,
    departureDate,
  });

  const url = `${getBaseUrl()}/carrierDispatch/clearStop/${stopId}?${qs.toString()}`;

  const res = await dependencyFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MCLEOD_AUTH_TOKEN}`,
      Accept: "text/plain",
    },
    cache: "no-store",
  });

  const text = await res.text();

  console.log("MCLEOD_CLEAR_STOP_RESPONSE", {
  stopId,
  arrivalDate,
  departureDate,
  status: res.status,
  ok: res.ok,
  body: text,
});

  return {
    ok: res.ok,
    status: res.status,
    body: text,
  };
}

function parseLocalDateOnly(value?: string | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    throw new Error("Missing received date - cannot clear stops");
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Number(y), Number(m) - 1, Number(d), 8, 0, 0, 0);
  }

  const dt = new Date(raw);

  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid received date: ${raw}`);
  }

  dt.setHours(8, 0, 0, 0);
  return dt;
}

function formatMcleodDateTime(date: Date) {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date object while formatting McLeod datetime");
  }

  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = "00";

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offsetHh = String(Math.floor(abs / 60)).padStart(2, "0");
  const offsetMm = String(abs % 60).padStart(2, "0");

  return `${yyyy}${mm}${dd}${hh}${mi}${ss}${sign}${offsetHh}${offsetMm}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function buildEventTimes(baseDateInput?: string | null) {
  const deliveryBaseDate = parseLocalDateOnly(baseDateInput);

  const pickupBaseDate = new Date(deliveryBaseDate);
  pickupBaseDate.setDate(pickupBaseDate.getDate() - 1);

  return {
    pickupArrival: formatMcleodDateTime(pickupBaseDate),
    pickupDeparture: formatMcleodDateTime(addMinutes(pickupBaseDate, 5)),
    deliveryArrival: formatMcleodDateTime(deliveryBaseDate),
    deliveryDeparture: formatMcleodDateTime(addMinutes(deliveryBaseDate, 5)),
  };
}

function getBaseDateFromRow(row: InboundExcelRow) {
  return (
    (row as any).receivedDate ??
    (row as any).received_date ??
    (row as any).date ??
    null
  );
}

function validationFailure(payload: Record<string, unknown>, status = 400) {
  return NextResponse.json(
    {
      ok: false,
      needsReview: true,
      ...payload,
    },
    { status }
  );
}

async function POSTHandler(req: NextRequest) {
  let liveAttempt: { sb: SupabaseClient; id: string; attemptId: string; saved: Record<string, any> } | null = null;
  let matchedOrderId: string | undefined;
  async function persistLivePhase(phase: "matched" | "write_pending", orderId: string) {
    if (!liveAttempt) return;
    const { data, error } = await liveAttempt.sb.from("inbound_checkin_rows")
      .update({ mcleod_processing_phase: phase, mcleod_lookup_status: "matched",
        mcleod_lookup_has_known_match: true, matched_order_id: orderId })
      .eq("id", liveAttempt.id).eq("draft_status", "processing")
      .eq("mcleod_lookup_attempt_id", liveAttempt.attemptId)
      .eq("mcleod_processing_phase", phase === "matched" ? "lookup" : "matched")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The processing attempt changed; McLeod writes are blocked");
  }
  try {
    const body = await req.json();
    let row = body.row;

    if (!row) {
      return NextResponse.json({ ok: false, error: "Missing row" }, { status: 400 });
    }

    if (row.source === "live_checkin") {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuid.test(String(body.checkinId ?? "")) || !uuid.test(String(body.lookupAttemptId ?? ""))) {
        return validationFailure({ error: "A claimed check-in processing attempt is required", reason: "INVALID_CHECKIN_ATTEMPT" });
      }
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Missing Supabase environment variables");
      const sb = createClient(url, key, { global: { fetch: dependencyFetch } });
      // Consume the server-created attempt exactly once. Concurrent/replayed sync
      // requests cannot progress from searching to another set of remote writes.
      const { data: saved, error } = await sb.from("inbound_checkin_rows")
        .update({ mcleod_lookup_status: "searching" })
        .eq("id", body.checkinId).eq("mcleod_lookup_attempt_id", body.lookupAttemptId)
        .eq("draft_status", "processing").eq("material_type", "cotton").eq("movement_direction", "delivery")
        .eq("mcleod_processing_phase", "lookup").eq("mcleod_lookup_status", "pending")
        .select("*").maybeSingle();
      if (error) throw error;
      if (!saved || saved.outside_carrier_override_at) {
        return validationFailure({ error: "This processing attempt is no longer available", reason: "CHECKIN_ATTEMPT_CHANGED" }, 409);
      }
      liveAttempt = { sb, id: body.checkinId, attemptId: body.lookupAttemptId, saved };
      // Caller-supplied freight, timing and location never override the claimed row.
      row = { source: "live_checkin", receivedDate: saved.received_date, mark: saved.mark,
        shipper: saved.shipper, bolBC: String(saved.bol_bc ?? ""), balesUnloaded: saved.bale_count,
        expectedBaleCount: saved.expected_bale_count, location: saved.warehouse_location,
        sourceSheet: saved.sub_location, terminal: saved.terminal, siteCode: saved.site_code,
        equipmentType: saved.equipment_type, checkedInAt: saved.checked_in_at, verifiedAt: saved.verified_at };
      if (staffProfile(req)?.role === "operator" && staffProfile(req)?.terminal !== row.terminal) {
        return validationFailure({ error: "This check-in belongs to another terminal", reason: "STAFF_TERMINAL_MISMATCH" }, 403);
      }
      const expected = Number(row.expectedBaleCount ?? row.bolBC);
      const received = Number(row.balesUnloaded);
      if (Number.isSafeInteger(expected) && expected > 0 && Number.isSafeInteger(received) && received < expected) {
        return validationFailure({ error: "Bale shortage - cannot post McLeod delivery", reason: "BALE_COUNT_MISMATCH", expectedBales: expected, receivedBales: received });
      }
    }
    let preview: SyncPreviewResult;
    try {
      preview = (await buildPreview([row], {
        strictSearch: row.source === "live_checkin",
        ...(liveAttempt?.saved.matched_order_id ? { preferredOrderId: String(liveAttempt.saved.matched_order_id) } : {}),
        ...(liveAttempt ? { onKnownMatch: async () => {
          const attempt = liveAttempt!;
          const { data, error } = await attempt.sb.from("inbound_checkin_rows")
            .update({ mcleod_lookup_has_known_match: true })
            .eq("id", attempt.id).eq("draft_status", "processing")
            .eq("mcleod_lookup_attempt_id", attempt.attemptId).eq("mcleod_processing_phase", "lookup")
            .eq("mcleod_lookup_status", "searching").select("id").maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("The lookup attempt changed; processing is blocked");
          attempt.saved.mcleod_lookup_has_known_match = true;
        } } : {}),
      }))[0] as SyncPreviewResult;
    } catch (error) {
      if (liveAttempt && error instanceof McleodLookupIncompleteError) {
        const knownMatch = error.hasKnownMatches || liveAttempt.saved.mcleod_lookup_has_known_match ||
          Boolean(liveAttempt.saved.matched_order_id || liveAttempt.saved.matched_stop_id);
        const { data, error: saveError } = await liveAttempt.sb.from("inbound_checkin_rows")
          .update({ mcleod_lookup_status: knownMatch ? "conflict" : "unresolved",
            mcleod_lookup_failure_code: error.code, mcleod_lookup_failed_at: new Date().toISOString(),
            ...(knownMatch ? { mcleod_lookup_has_known_match: true } : {}) })
          .eq("id", liveAttempt.id).eq("draft_status", "processing")
          .eq("mcleod_lookup_attempt_id", liveAttempt.attemptId).eq("mcleod_processing_phase", "lookup")
          .eq("mcleod_lookup_status", "searching").select("id").maybeSingle();
        if (saveError) throw saveError;
        if (!data) throw new Error("The lookup attempt changed; processing is blocked");
        return NextResponse.json({ ok: false, error: error.message,
          code: knownMatch ? "MCLEOD_LOOKUP_CONFLICT" : "MCLEOD_LOOKUP_UNRESOLVED",
          lookupFailure: { phase: "lookup", attemptId: liveAttempt.attemptId,
            code: error.code, hasKnownMatches: Boolean(knownMatch) } }, { status: 409 });
      }
      throw error;
    }

    if (!preview || !preview.matchedOrderId) {
      if (row.source === "live_checkin" && isOutsideCarrierNoMatch(preview)) {
        if (liveAttempt?.saved.matched_order_id || liveAttempt?.saved.matched_stop_id || liveAttempt?.saved.mcleod_lookup_has_known_match) {
          return validationFailure({ error: "The saved McLeod match was not found. Review it before completing receiving.",
            reason: "KNOWN_MATCH_NOT_FOUND", matchedOrderId: liveAttempt.saved.matched_order_id });
        }
        return NextResponse.json({
          ok: true, skipped: true, outsideCarrier: true,
          reason: "No McLeod order found for this mark; treated as outside carrier",
        });
      }
      return NextResponse.json(
        { ok: false, error: "No match", preview },
        { status: 400 }
      );
    }

    matchedOrderId = preview.matchedOrderId;
    if (liveAttempt?.saved.matched_order_id && liveAttempt.saved.matched_order_id !== matchedOrderId) {
      return validationFailure({ error: "The lookup conflicts with the saved McLeod order", reason: "KNOWN_MATCH_CONFLICT",
        matchedOrderId: liveAttempt.saved.matched_order_id });
    }
    await persistLivePhase("matched", matchedOrderId);
    const baleCount = resolveBales(row, preview);

    const isStrong = preview.status === "Matched";
    const isSafePossible =
      preview.status === "Possible Match" &&
      preview.candidateCount === 1 &&
      baleCount !== null;

    if (!isStrong && !isSafePossible) {
      return validationFailure({
        error: "Not safe to auto-process",
        reason: "UNSAFE_MATCH",
        preview,
        row,
      });
    }

    const order = await getOrder(preview.matchedOrderId);
    if (staffProfile(req)?.role === "operator") {
      const site = getCheckinSite(row.terminal, row.siteCode);
      if (!site || site.terminal !== staffProfile(req)!.terminal) {
        return validationFailure({ error: "Could not verify the delivery warehouse", reason: "STAFF_TERMINAL_MISMATCH" });
      }
      const yard = await lookupMcleodGateOrder(preview.matchedOrderId, site.terminal, site.siteName);
      if (yard.direction !== "delivery" || yard.stopId !== order.stops?.find((stop: McleodStop) => stop.stop_type === "SO")?.id) {
        return validationFailure({ error: "This delivery belongs to another warehouse or needs review", reason: "STAFF_TERMINAL_MISMATCH" });
      }
    }

    if (row.source === "live_checkin") {
      const eligibility = currentCottonOrder(order, row.receivedDate);
      if (!eligibility.eligible) return validationFailure({ error: eligibility.reason, reason: "HISTORICAL_OR_UNVERIFIED_ORDER", matchedOrderId: preview.matchedOrderId });
    }
    const rowMark = resolveRowMark(row, preview);
    const orderMark = resolveOrderMark(order, preview);

    if (rowMark && orderMark && rowMark !== orderMark) {
      return validationFailure({
        error: "Mark mismatch - blocked delivery",
        reason: "MARK_MISMATCH",
        matchedOrderId: preview.matchedOrderId,
        inboundMark: rowMark,
        mcleodMark: orderMark,
        preview,
        row,
      });
    }

    const rowCustomer = expectedCustomerId(preview, resolveRowCustomer(row));
    const orderCustomer = resolveOrderCustomer(order);

    if (rowCustomer && orderCustomer && rowCustomer !== orderCustomer) {
      return validationFailure({
        error: "Customer mismatch - blocked delivery",
        reason: "CUSTOMER_MISMATCH",
        matchedOrderId: preview.matchedOrderId,
        inboundCustomer: rowCustomer,
        mcleodCustomer: orderCustomer,
        preview,
        row,
      });
    }

    const orderBales = resolveOrderBales(order, preview);

    if (baleCount !== null && orderBales !== null && baleCount !== orderBales) {
      return validationFailure({
        error: "Bale count mismatch - blocked delivery",
        reason: "BALE_COUNT_MISMATCH",
        matchedOrderId: preview.matchedOrderId,
        inboundBales: baleCount,
        mcleodBales: orderBales,
        preview,
        row,
      });
    }

    if (order.status === "D") {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Already delivered",
        matchedOrderId: preview.matchedOrderId,
        row,
      });
    }

    const movement = order.movements?.[0] as McleodMovement | undefined;

    const pickup = order.stops?.find((s: McleodStop) => s.stop_type === "PU") as
      | McleodStop
      | undefined;

    const delivery = order.stops?.find((s: McleodStop) => s.stop_type === "SO") as
      | McleodStop
      | undefined;

    if (!movement?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "No movement found",
          reason: "NO_MOVEMENT_FOUND",
          matchedOrderId: preview.matchedOrderId,
          row,
        },
        { status: 500 }
      );
    }

    if (!pickup?.id || !delivery?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing pickup or delivery stop",
          reason: "MISSING_PICKUP_OR_DELIVERY_STOP",
          matchedOrderId: preview.matchedOrderId,
          row,
        },
        { status: 500 }
      );
    }

    if (liveAttempt?.saved.matched_stop_id && liveAttempt.saved.matched_stop_id !== delivery.id) {
      return validationFailure({ error: "The lookup conflicts with the saved McLeod stop", reason: "KNOWN_STOP_CONFLICT", matchedOrderId });
    }
    const pickupHas = hasActuals(pickup);
    const deliveryHas = hasActuals(delivery);

    // An already-completed delivery is an idempotent success. Once the order
    // and persisted stop have been verified, no new timeline should be planned
    // against yesterday's actuals and no McLeod write should be attempted.
    if (row.source === "live_checkin" && deliveryHas && isSyncEnabled()) {
      return NextResponse.json({
        ok: true, skipped: true, reason: "Delivery already has actuals",
        matchedOrderId: preview.matchedOrderId, movementId: movement.id,
      });
    }

    if (row.source === "live_checkin") {
      const arrival = new Date(row.checkedInAt ?? "");
      const departure = new Date(row.verifiedAt ?? "");
      if (Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime()) ||
          departure.getTime() < arrival.getTime() ||
          (row.terminal !== "SAV" && row.terminal !== "HOU")) {
        return validationFailure({
          error: "Invalid check-in or verification time - blocked delivery",
          reason: "INVALID_CHECKIN_TIME", matchedOrderId: preview.matchedOrderId,
        });
      }
      let plannedActions: ReturnType<typeof planLiveDeliveryActuals>;
      try {
        plannedActions = planLiveDeliveryActuals({
          receivedDate: String(getBaseDateFromRow(row) ?? ""), terminal: row.terminal,
          checkedInAt: arrival, verifiedAt: departure,
          pickups: order.stops.filter((stop: McleodStop) => stop.stop_type === "PU"), delivery,
        });
      } catch (error) {
        return validationFailure({
          error: error instanceof Error ? error.message : "Could not plan pickup and delivery actuals",
          reason: "INVALID_STOP_ACTUALS", matchedOrderId: preview.matchedOrderId,
        });
      }

      if (!isSyncEnabled()) {
        return NextResponse.json({
          ok: true, mode: "safe", matchedOrderId: preview.matchedOrderId,
          movementId: movement.id, plannedActions, row,
        });
      }
      // Persist before the first pickup/backfill OR delivery write. Even a timeout
      // or lost response after this point can never become an outside-carrier offer.
      await persistLivePhase("write_pending", preview.matchedOrderId);
      const pickupRes = plannedActions.pickup.skipped
        ? { ok: true, status: 200, body: "Pickup already had actuals" }
        : await clearCarrierStop(pickup.id, plannedActions.pickup.arrivalDate, plannedActions.pickup.departureDate);
      if (!pickupRes.ok) {
        return NextResponse.json({
          ok: false, error: "Failed to fill missing pickup actuals; delivery was not posted",
          reason: "PICKUP_CLEAR_STOP_FAILED", matchedOrderId: preview.matchedOrderId,
          movementId: movement.id, plannedActions, mcleodResponse: { ok: false, pickup: pickupRes },
        });
      }
      const deliveryRes = await clearCarrierStop(delivery.id,
        plannedActions.delivery.arrivalDate, plannedActions.delivery.departureDate);
      return NextResponse.json({
        ok: deliveryRes.ok,
        error: deliveryRes.ok ? undefined : "Failed to clear delivery stop",
        reason: deliveryRes.ok ? undefined : "DELIVERY_CLEAR_STOP_FAILED",
        matchedOrderId: preview.matchedOrderId, movementId: movement.id,
        plannedActions, mcleodResponse: { ok: deliveryRes.ok, pickup: pickupRes, delivery: deliveryRes },
      });
    }

    const baseDate = getBaseDateFromRow(row);
    const times = buildEventTimes(baseDate);

    const plannedActions = {
      pickup: pickupHas
        ? {
            skipped: true,
            reason: "Pickup already had actuals",
            stopId: pickup.id,
          }
        : {
            skipped: false,
            stopId: pickup.id,
            arrivalDate: times.pickupArrival,
            departureDate: times.pickupDeparture,
          },
      delivery: deliveryHas
        ? {
            skipped: true,
            reason: "Delivery already had actuals",
            stopId: delivery.id,
          }
        : {
            skipped: false,
            stopId: delivery.id,
            arrivalDate: times.deliveryArrival,
            departureDate: times.deliveryDeparture,
          },
    };

    if (!isSyncEnabled()) {
      return NextResponse.json({
        ok: true,
        mode: "safe",
        matchedOrderId: preview.matchedOrderId,
        movementId: movement.id,
        usedPossibleMatch: isSafePossible,
        validation: {
          mark: {
            inbound: rowMark,
            mcleod: orderMark,
            ok: !rowMark || !orderMark || rowMark === orderMark,
          },
          customer: {
            inbound: rowCustomer,
            mcleod: orderCustomer,
            ok: !rowCustomer || !orderCustomer || rowCustomer === orderCustomer,
          },
          bales: {
            inbound: baleCount,
            mcleod: orderBales,
            ok: baleCount === null || orderBales === null || baleCount === orderBales,
          },
        },
        pickupHasActuals: pickupHas,
        deliveryHasActuals: deliveryHas,
        generatedTimes: times,
        plannedActions,
        row,
      });
    }

    const pickupRes = pickupHas
      ? {
          ok: true,
          status: 200,
          body: "Pickup already had actuals",
        }
      : await clearCarrierStop(pickup.id, times.pickupArrival, times.pickupDeparture);

    if (!pickupRes.ok) {
      return NextResponse.json({
        ok: false,
        error: "Failed to clear pickup stop",
        reason: "PICKUP_CLEAR_STOP_FAILED",
        matchedOrderId: preview.matchedOrderId,
        movementId: movement.id,
        generatedTimes: times,
        plannedActions,
        mcleodResponse: {
          pickup: pickupRes,
        },
        row,
      });
    }

    const deliveryRes = deliveryHas
      ? {
          ok: true,
          status: 200,
          body: "Delivery already had actuals",
        }
      : await clearCarrierStop(
          delivery.id,
          times.deliveryArrival,
          times.deliveryDeparture
        );

    const allOk = pickupRes.ok && deliveryRes.ok;

    return NextResponse.json({
      ok: allOk,
      error: allOk ? undefined : "Failed to clear delivery stop",
      reason: allOk ? undefined : "DELIVERY_CLEAR_STOP_FAILED",
      matchedOrderId: preview.matchedOrderId,
      movementId: movement.id,
      usedPossibleMatch: isSafePossible,
      validation: {
        mark: {
          inbound: rowMark,
          mcleod: orderMark,
          ok: !rowMark || !orderMark || rowMark === orderMark,
        },
        customer: {
          inbound: rowCustomer,
          mcleod: orderCustomer,
          ok: !rowCustomer || !orderCustomer || rowCustomer === orderCustomer,
        },
        bales: {
          inbound: baleCount,
          mcleod: orderBales,
          ok: baleCount === null || orderBales === null || baleCount === orderBales,
        },
      },
      pickupHasActuals: pickupHas,
      deliveryHasActuals: deliveryHas,
      generatedTimes: times,
      plannedActions,
      mcleodResponse: {
        ok: allOk,
        pickup: pickupRes,
        delivery: deliveryRes,
      },
      row,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
        ...(matchedOrderId ? { matchedOrderId } : {}),
      },
      { status: 500 }
    );
  }
}

export const POST = withStaffAccess(POSTHandler);
