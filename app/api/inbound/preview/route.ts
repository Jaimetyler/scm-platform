import { NextResponse } from "next/server";
import { buildPreview } from "@/lib/mcleod/inbound/buildPreview";
import { MOCK_ROWS } from "@/lib/mcleod/inbound/mockRows";

export async function GET() {
  try {
    console.log("PREVIEW_ROUTE_VERSION", "2026-03-23-v2");

    const results = await buildPreview(MOCK_ROWS);

    return NextResponse.json({
      ok: true,
      routeVersion: "2026-03-23-v2",
      count: results.length,
      debug: results.map((item, index) => ({
        index,
        mark: item.row.mark,
        status: item.status,
        candidateCount: item.candidateCount,
        matchedOrderId: item.matchedOrderId ?? null,
        reason: item.reason,
        parsedBlnum: item.parsedBlnum ?? null,
        proposed: item.proposed ?? null,
      })),
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        routeVersion: "2026-03-23-v2",
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}