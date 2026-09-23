import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { normalizeInventoryUpdate } from "@/lib/warehouse/inventory";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

function requestUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return "warehouse user";
  try {
    return atob(auth.slice(6)).split(":")[0]?.trim() || "warehouse user";
  } catch {
    return "warehouse user";
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid inventory identifier" }, { status: 400 });
    }

    const body = await req.json();
    const terminal = String(body?.terminal ?? "").trim().toUpperCase();
    const siteCode = String(body?.siteCode ?? "").trim();
    const expectedUpdatedAt = String(body?.expectedUpdatedAt ?? "").trim();
    if (!CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode)) {
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    }
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
      return NextResponse.json({ ok: false, error: "Reload this inventory row before saving" }, { status: 409 });
    }

    let values;
    try {
      values = normalizeInventoryUpdate(body as Record<string, unknown>);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid inventory update" }, { status: 400 });
    }

    const { data, error } = await database().rpc("update_warehouse_inventory_lot", {
      p_id: id,
      p_terminal: terminal,
      p_site_code: siteCode,
      p_expected_updated_at: expectedUpdatedAt,
      p_current_bales: values.currentBales,
      p_allocated_bales: values.allocatedBales,
      p_missing_bales: values.missingBales,
      p_warehouse_location: values.warehouseLocation,
      p_booking_number: values.bookingNumber,
      p_inventory_status: values.inventoryStatus,
      p_notes: values.notes,
      p_changed_by: requestUser(req),
    });
    if (error) {
      const conflict = /another browser|not found/i.test(error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: conflict ? 409 : 400 });
    }

    return NextResponse.json({ ok: true, row: data?.[0] ?? null });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save inventory",
    }, { status: 500 });
  }
}
