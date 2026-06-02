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

 // console.log("MCLEOD_CLEAR_STOP_URL", url);//

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

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Number(y), Number(m) - 1, Number(d), 8, 0, 0, 0);
  }

  const dt = raw ? new Date(raw) : new Date();
  dt.setHours(8, 0, 0, 0);
  return dt;
}

function formatMcleodDateTime(date: Date) {
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
        {
          ok: false,
          error: "No movement found",
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
          matchedOrderId: preview.matchedOrderId,
          row,
        },
        { status: 500 }
      );
    }

    const pickupHas = hasActuals(pickup);
    const deliveryHas = hasActuals(delivery);

    const baseDate =
      (row as any).receivedDate ||
      (row as any).received_date ||
      (row as any).date ||
      null;

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
      matchedOrderId: preview.matchedOrderId,
      movementId: movement.id,
      usedPossibleMatch: isSafePossible,
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