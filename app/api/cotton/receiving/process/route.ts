import { NextRequest, NextResponse } from "next/server";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import { MOCK_ROWS } from "@/lib/mcleod/inbound/mockRows";

function getBaseUrl() {
  const baseUrl = process.env.MCLEOD_BASE_URL;
  if (!baseUrl) throw new Error("Missing MCLEOD_BASE_URL");
  return baseUrl.replace(/\/+$/, "");
}

function getHeaders() {
  const token = process.env.MCLEOD_AUTH_TOKEN;
  if (!token) throw new Error("Missing MCLEOD_AUTH_TOKEN");

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function isSafeMode() {
  return process.env.MCLEOD_SYNC_ENABLED !== "true";
}

export async function POST(req: NextRequest) {
  try {
    const { rowIndex } = await req.json();

    const preview = await buildPreview(MOCK_ROWS);

    console.log(
      "PROCESS PREVIEW SUMMARY",
      preview.map((item, index) => ({
        index,
        mark: item.row.mark,
        shipper: item.row.shipper,
        status: item.status,
        candidateCount: item.candidateCount,
        matchedOrderId: item.matched?.orderId ?? null,
        hasProposed: !!item.proposed,
      }))
    );

    const item = preview[rowIndex];

    if (!item) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid row index",
          availableRows: preview.map((p, index) => ({
            index,
            mark: p.row.mark,
            status: p.status,
          })),
        },
        { status: 400 }
      );
    }

    if (!item.matched) {
      return NextResponse.json(
        {
          ok: false,
          error: "No matched order",
          rowIndex,
          row: item.row,
          previewStatus: item.status,
          candidateCount: item.candidateCount,
          availableRows: preview.map((p, index) => ({
            index,
            mark: p.row.mark,
            status: p.status,
            candidateCount: p.candidateCount,
            matchedOrderId: p.matched?.orderId ?? null,
          })),
        },
        { status: 400 }
      );
    }

    if (!item.proposed) {
      return NextResponse.json(
        {
          ok: false,
          error: "No proposed update",
          rowIndex,
          row: item.row,
          previewStatus: item.status,
          matchedOrderId: item.matched.orderId,
        },
        { status: 400 }
      );
    }

    const orderId = item.matched.orderId;

    const payload: Record<string, any> = {
      id: orderId,
      dest_actual_arrival: item.proposed.destActualArrival,
      dest_actual_departure: item.proposed.destActualDeparture,
      status: "D",
      brokerage_status: "finished",
    };

    if (item.proposed.originActualArrival) {
      payload.origin_actual_arrival = item.proposed.originActualArrival;
    }

    if (item.proposed.originActualDeparture) {
      payload.origin_actual_departure = item.proposed.originActualDeparture;
    }

    if (isSafeMode()) {
      console.log("SAFE MODE - WOULD UPDATE", {
        rowIndex,
        row: item.row,
        orderId,
        payload,
      });

      return NextResponse.json({
        ok: true,
        mode: "safe",
        message: "Update simulated (safe mode)",
        rowIndex,
        row: item.row,
        orderId,
        payload,
      });
    }

    const baseUrl = getBaseUrl();

    console.log("SENDING UPDATE", {
      rowIndex,
      row: item.row,
      orderId,
      payload,
    });

    const res = await fetch(`${baseUrl}/orders/update`, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      console.log("UPDATE FAILED", {
        status: res.status,
        body: data,
        payload,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Update failed",
          details: data,
          payload,
        },
        { status: 500 }
      );
    }

    console.log("UPDATE SUCCESS", data);

    return NextResponse.json({
      ok: true,
      mode: "live",
      rowIndex,
      row: item.row,
      orderId,
      payload,
      response: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}