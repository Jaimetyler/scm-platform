import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    const { searchParams } = new URL(req.url);

    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const customer = searchParams.get("customer");

    let query = sb
      .from("inbound_results")
      .select("*")
      .order("received_date", { ascending: false })
      .order("mark", { ascending: true })
      .limit(5000);

    if (startDate) {
      query = query.gte("received_date", startDate);
    }

    if (endDate) {
      query = query.lte("received_date", endDate);
    }

    if (customer) {
      query = query.eq("shipper", customer);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    // separate customer list query so dropdown is always populated
    const { data: customerRows, error: customerError } = await sb
      .from("inbound_results")
      .select("shipper")
      .not("shipper", "is", null)
      .limit(5000);

    if (customerError) {
      return NextResponse.json(
        { ok: false, error: customerError.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []).map((row) => {
      const derivedDisposition =
        row.disposition === "outside_carrier"
          ? "outside_carrier"
          : row.disposition === "confirmed_match"
          ? "confirmed_match"
          : row.status === "failed" && !row.matched_order_id
          ? "outside_carrier"
          : row.disposition ?? "unresolved";

      return {
        ...row,
        derivedDisposition,
      };
    });

    const totalRows = rows.length;

    const matchedRows = rows.filter(
      (r) => r.derivedDisposition === "confirmed_match"
    );
    const outsideCarrierRows = rows.filter(
      (r) => r.derivedDisposition === "outside_carrier"
    );
    const unresolvedRows = rows.filter(
      (r) =>
        r.derivedDisposition !== "confirmed_match" &&
        r.derivedDisposition !== "outside_carrier"
    );

    const classifiedTotal = matchedRows.length + outsideCarrierRows.length;

    const matchedPct =
      classifiedTotal > 0
        ? Number(((matchedRows.length / classifiedTotal) * 100).toFixed(1))
        : 0;

    const outsideCarrierPct =
      classifiedTotal > 0
        ? Number(((outsideCarrierRows.length / classifiedTotal) * 100).toFixed(1))
        : 0;

    const customers = Array.from(
      new Set(
        (customerRows ?? [])
          .map((r) => String(r.shipper ?? "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      ok: true,
      filters: {
        startDate,
        endDate,
        customer,
      },
      summary: {
        totalRows,
        matchedTotal: matchedRows.length,
        outsideCarrierTotal: outsideCarrierRows.length,
        unresolvedTotal: unresolvedRows.length,
        classifiedTotal,
        matchedPct,
        outsideCarrierPct,
      },
      customers,
      rows,
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