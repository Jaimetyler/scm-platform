import { NextRequest, NextResponse } from "next/server";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";

export const runtime = "nodejs";

type SyncPreviewResult = {
  status?: string;
  matchedOrderId?: string;
  reason?: string;
  candidateCount?: number;
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
  sched_arrive_early?: string | null;
  sched_arrive_late?: string | null;
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

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function resolveBales(row: InboundExcelRow, preview: SyncPreviewResult): number | null {
  return (
    parseNum(row.balesUnloaded) ??
    parseNum(row.bolBC) ??
    parseNum(preview?.parsedBlnum?.count) ??
    null
  );
}

function hasActuals(stop: McleodStop | undefined) {
  return !!(stop?.actual_arrival && stop?.actual_departure);
}

function buildStopPayload(
  stopId: string,
  actualArrival?: string | null,
  actualDeparture?: string | null
) {
  const payload: Record<string, unknown> = {
    __type: "stop",
    id: stopId,
  };

  if (actualArrival) payload.actual_arrival = actualArrival;
  if (actualDeparture) payload.actual_departure = actualDeparture;

  return payload;
}

function buildMovementPayload(movementId: string, brokerageStatus: string) {
  return {
    __type: "movement",
    id: movementId,
    brokerage_status: brokerageStatus,
  };
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

async function updateOrder(payload: Record<string, unknown>) {
  console.log("MCLEOD_UPDATE_ORDER_PAYLOAD", JSON.stringify(payload, null, 2));

  const res = await fetch(`${getBaseUrl()}/orders/update`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    body: text,
  };
}

function formatMcleodDateTime(date: Date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  if (hours === 0) hours = 12;

  const hh = String(hours).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${hh}:${minutes}${ampm}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function buildEventTimes() {
  const now = new Date();

  // round up to the next minute so we don't send odd seconds
  now.setSeconds(0, 0);

  const pickupArrival = now;
  const pickupDeparture = addMinutes(pickupArrival, 5);
  const deliveryArrival = addMinutes(pickupDeparture, 60);
  const deliveryDeparture = addMinutes(deliveryArrival, 5);

  return {
    pickupArrival: formatMcleodDateTime(pickupArrival),
    pickupDeparture: formatMcleodDateTime(pickupDeparture),
    deliveryArrival: formatMcleodDateTime(deliveryArrival),
    deliveryDeparture: formatMcleodDateTime(deliveryDeparture),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { row } = await req.json();

    if (!row) {
      return NextResponse.json({ ok: false, error: "Missing row" }, { status: 400 });
    }

    const preview = (await buildPreview([row]))[0] as SyncPreviewResult;

    if (!preview || !preview.matchedOrderId) {
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
      return NextResponse.json(
        {
          ok: false,
          needsReview: true,
          error: "Not safe to auto-process",
          preview,
        },
        { status: 400 }
      );
    }

    const order = await getOrder(preview.matchedOrderId);

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
        { ok: false, error: "No movement found", matchedOrderId: preview.matchedOrderId, row },
        { status: 500 }
      );
    }

    if (!pickup?.id || !delivery?.id) {
      return NextResponse.json(
        { ok: false, error: "Missing pickup or delivery stop", matchedOrderId: preview.matchedOrderId, row },
        { status: 500 }
      );
    }

    const pickupHas = hasActuals(pickup);
    const deliveryHas = hasActuals(delivery);
    const times = buildEventTimes();

    const payload = {
      __type: "orders",
      id: preview.matchedOrderId,
      stops: [
        buildStopPayload(
          pickup.id,
          pickupHas ? pickup.actual_arrival ?? undefined : times.pickupArrival,
          pickupHas ? pickup.actual_departure ?? undefined : times.pickupDeparture
        ),
        buildStopPayload(
          delivery.id,
          deliveryHas ? delivery.actual_arrival ?? undefined : times.deliveryArrival,
          deliveryHas ? delivery.actual_departure ?? undefined : times.deliveryDeparture
        ),
      ],
      movements: [buildMovementPayload(movement.id, "FINISHED")],
    };

    if (!isSyncEnabled()) {
      return NextResponse.json({
        ok: true,
        mode: "safe",
        matchedOrderId: preview.matchedOrderId,
        usedPossibleMatch: isSafePossible,
        pickupHasActuals: pickupHas,
        deliveryHasActuals: deliveryHas,
        generatedTimes: times,
        payload,
        row,
      });
    }

    const res = await updateOrder(payload);

    return NextResponse.json({
      ok: res.ok,
      matchedOrderId: preview.matchedOrderId,
      usedPossibleMatch: isSafePossible,
      pickupHasActuals: pickupHas,
      deliveryHasActuals: deliveryHas,
      generatedTimes: times,
      payload,
      mcleodResponse: res,
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