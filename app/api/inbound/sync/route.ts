import { NextRequest, NextResponse } from "next/server";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";
import { formatWarehouseTime } from "@/lib/inbound/checkin/mcleod-time";
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
  const res = await fetch(`${getBaseUrl()}/orders/${orderId}`, {
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

  const res = await fetch(url, {
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

export async function POST(req: NextRequest) {
  try {
    const { row } = await req.json();

    if (!row) {
      return NextResponse.json({ ok: false, error: "Missing row" }, { status: 400 });
    }

    const preview = (await buildPreview([row], {
      strictSearch: row.source === "live_checkin",
    }))[0] as SyncPreviewResult;

    if (!preview || !preview.matchedOrderId) {
      if (row.source === "live_checkin" && isOutsideCarrierNoMatch(preview)) {
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

    const pickupHas = hasActuals(pickup);
    const deliveryHas = hasActuals(delivery);

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
      if (!pickupHas) {
        return validationFailure({
          error: "Pickup has no actual arrival/departure. Review it in McLeod before completing delivery.",
          reason: "PICKUP_ACTUALS_MISSING", matchedOrderId: preview.matchedOrderId,
        });
      }

      const deliveryArrival = formatWarehouseTime(arrival, row.terminal);
      const deliveryDeparture = formatWarehouseTime(departure, row.terminal);
      const plannedActions = {
        pickup: { skipped: true, reason: "Pickup already has actuals", stopId: pickup.id },
        delivery: deliveryHas
          ? { skipped: true, reason: "Delivery already has actuals", stopId: delivery.id }
          : { skipped: false, stopId: delivery.id, arrivalDate: deliveryArrival, departureDate: deliveryDeparture },
      };

      if (!isSyncEnabled()) {
        return NextResponse.json({
          ok: true, mode: "safe", matchedOrderId: preview.matchedOrderId,
          movementId: movement.id, plannedActions, row,
        });
      }
      if (deliveryHas) {
        return NextResponse.json({
          ok: true, skipped: true, reason: "Delivery already has actuals",
          matchedOrderId: preview.matchedOrderId, plannedActions,
        });
      }

      const deliveryRes = await clearCarrierStop(delivery.id, deliveryArrival, deliveryDeparture);
      return NextResponse.json({
        ok: deliveryRes.ok,
        error: deliveryRes.ok ? undefined : "Failed to clear delivery stop",
        reason: deliveryRes.ok ? undefined : "DELIVERY_CLEAR_STOP_FAILED",
        matchedOrderId: preview.matchedOrderId, movementId: movement.id,
        plannedActions, mcleodResponse: { ok: deliveryRes.ok, delivery: deliveryRes },
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
      },
      { status: 500 }
    );
  }
}
