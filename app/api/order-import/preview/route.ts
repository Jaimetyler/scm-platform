import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalize(desc: string) {
  return desc?.trim().toUpperCase() || "";
}

export async function POST(req: NextRequest) {
  try {
    const { csvText, terminal } = await req.json();

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const rows = parsed.data as any[];

    // Get mappings
    const { data: descMap } = await supabase
      .from("billing_charge_description_xref")
      .select("*")
      .eq("terminal", terminal);

    const { data: tariffMap } = await supabase
      .from("tariff_charge_xref")
      .select("*")
      .eq("terminal", terminal);

    const descLookup = new Map(
      descMap?.map((r) => [r.normalized_description, r.tariff_id])
    );

    const tariffLookup = new Map(
      tariffMap?.map((r) => [r.tariff_id, r.mcleod_code])
    );

    const grouped: Record<string, any[]> = {};

    for (const r of rows) {
      const orderNo = String(r["Shipping Order #"] || "").trim();
      const desc = normalize(r["Description"]);
      const qty = Number(r["Quantity"] || 0);
      const amount = Number(r["Total Charges"] || 0);

      if (!orderNo) continue;
      if (!desc) continue; // skip blank lines (totals)

      const tariffId = descLookup.get(desc);
      if (!tariffId) continue;

      const mcleodCode = tariffLookup.get(tariffId);
      if (!mcleodCode) continue;

      if (!grouped[orderNo]) grouped[orderNo] = [];

      grouped[orderNo].push({
        tariff_id: tariffId,
        charge_id: mcleodCode,
        units: qty || 1,
        amount,
      });
    }

    const preview = Object.entries(grouped).map(([orderNo, charges]) => ({
      blnum: orderNo,
      charges,
    }));

    return NextResponse.json({
      ok: true,
      count: preview.length,
      preview,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}