import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { readRun } from "@/lib/dray/server";
import { findSavannahInterchangeBookings, readSavannahInterchangePdf } from "@/lib/sharepoint/e2open-documents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withStaffAccess(async request => {
  try {
    const params = request.nextUrl.searchParams;
    const runId = params.get("run") ?? "";
    const rowId = params.get("row") ?? "";
    const booking = params.get("booking") ?? "";
    const direction = params.get("direction");
    if (!uuid.test(runId) || !uuid.test(rowId) || !/^[A-Z0-9_-]+$/i.test(booking) ||
        (direction !== "in" && direction !== "out")) {
      throw Error("Select a saved Savannah interchange PDF.");
    }

    const {items} = await readRun(staffDatabase(), runId);
    const item = items.find(candidate => candidate.order_id === rowId);
    const row = item?.order;
    if (!item || !row || item.conflict || item.source_hash !== row.source_hash ||
        row.profile.id !== "DRAY-SAV-SAVWHSE" || !row.order_id ||
        !["verified", "delivered"].includes(row.status)) {
      throw Error("Interchanges require an imported Savannah order.");
    }

    if (booking.toUpperCase() !== row.invoice.booking.toUpperCase()) {
      const matches = await findSavannahInterchangeBookings(row.invoice.container, row.invoice.booking, true);
      if (!matches.some(match => match.booking === booking && (direction === "in" ? match.inbound : match.outbound))) {
        throw Error("The selected PDF does not match this saved order.");
      }
    }

    const {bytes, filename} = await readSavannahInterchangePdf(booking, row.invoice.container, direction);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {ok: false, error: error instanceof Error ? error.message : "Interchange download failed."},
      {status: 400},
    );
  }
});
