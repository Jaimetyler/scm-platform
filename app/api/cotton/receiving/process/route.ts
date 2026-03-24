import { NextRequest, NextResponse } from "next/server";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import type { InboundExcelRow } from "@/lib/mcleod/inbound/types";

export const runtime = "nodejs";

type ProcessRequestBody = {
  rows?: InboundExcelRow[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ProcessRequestBody;
    const rows = body?.rows ?? [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing rows array in request body",
        },
        { status: 400 }
      );
    }

    const preview = await buildPreview(rows);

    return NextResponse.json({
      ok: true,
      count: preview.length,
      results: preview.map((item) => ({
        row: item.row,
        resolvedCustomer: item.resolvedCustomer,
        status: item.status,
        candidateCount: item.candidateCount,
        matchedOrderId: item.matchedOrderId ?? null,
        reason: item.reason,
        parsedBlnum: item.parsedBlnum,
        hasProposed: !!item.proposed,
        proposed: item.proposed ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}