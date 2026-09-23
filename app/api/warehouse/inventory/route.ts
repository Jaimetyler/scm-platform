import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { INVENTORY_STATUSES, safeInventorySearch } from "@/lib/warehouse/inventory";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const terminal = String(searchParams.get("terminal") ?? "").trim().toUpperCase();
    const siteCode = String(searchParams.get("siteCode") ?? "").trim();
    const status = String(searchParams.get("status") ?? "open").trim();
    const search = safeInventorySearch(searchParams.get("search"));
    const requestedPage = Number(searchParams.get("page") ?? 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = 100;

    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode);
    if (!site) {
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    }
    if (status !== "all" && status !== "open" &&
        !INVENTORY_STATUSES.includes(status as (typeof INVENTORY_STATUSES)[number])) {
      return NextResponse.json({ ok: false, error: "Invalid inventory status" }, { status: 400 });
    }

    const sb = database();
    let query = sb.from("warehouse_inventory_lots")
      .select("*", { count: "exact" })
      .eq("terminal", terminal)
      .eq("site_code", siteCode);

    if (status === "open") query = query.neq("inventory_status", "closed");
    else if (status !== "all") query = query.eq("inventory_status", status);
    if (search) {
      const term = `%${search}%`;
      query = query.or(
        `mark.ilike.${term},customer.ilike.${term},booking_number.ilike.${term},warehouse_location.ilike.${term}`
      );
    }

    const from = (page - 1) * pageSize;
    const [{ data, error, count }, summaryResult] = await Promise.all([
      query.order("received_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1),
      sb.rpc("warehouse_inventory_summary", { p_terminal: terminal, p_site_code: siteCode }),
    ]);
    if (error) throw error;
    if (summaryResult.error) throw summaryResult.error;

    const totalRows = count ?? 0;
    return NextResponse.json({
      ok: true,
      site,
      rows: data ?? [],
      summary: summaryResult.data?.[0] ?? {
        total_lots: 0, current_bales: 0, allocated_bales: 0,
        available_bales: 0, missing_bales: 0, pending_receipts: 0,
      },
      pagination: {
        page,
        pageSize,
        totalRows,
        pageCount: Math.max(1, Math.ceil(totalRows / pageSize)),
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not load inventory",
    }, { status: 500 });
  }
}
