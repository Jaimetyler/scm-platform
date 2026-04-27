import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalize(value: any) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function cleanAmount(value: any) {
  return Number(String(value || "0").replace(/[$,]/g, "").trim());
}

function cleanCsvToRealHeader(csvText: string) {
  const lines = csvText.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    line.toUpperCase().includes("SHIPPING ORDER #")
  );

  if (headerIndex === -1) return csvText;

  return lines.slice(headerIndex).join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const { csvText, terminal } = await req.json();

    const cleanedCsv = cleanCsvToRealHeader(csvText || "");

    const parsed = Papa.parse(cleanedCsv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => normalize(h),
    });

    const rows = parsed.data as any[];

    const { data: descMap, error: descError } = await supabase
      .from("billing_charge_description_xref")
      .select("*")
      .eq("terminal", terminal)
      .eq("active", true);

    if (descError) throw descError;

    const { data: tariffMap, error: tariffError } = await supabase
      .from("tariff_charge_xref")
      .select("*")
      .eq("terminal", terminal)
      .eq("active", true);

    if (tariffError) throw tariffError;

    const descLookup = new Map(
      (descMap || []).map((r) => [
        normalize(r.normalized_description),
        Number(r.tariff_id),
      ])
    );

    const tariffLookup = new Map(
      (tariffMap || []).map((r) => [
        Number(r.tariff_id),
        {
          charge_id: String(r.mcleod_code),
          description: String(r.description || r.mcleod_code),
        },
      ])
    );

    const grouped: Record<string, any[]> = {};
    const skipped: any[] = [];

    for (const r of rows) {
      const orderNo = String(r["SHIPPING ORDER #"] || "").trim();
      const desc = normalize(r["DESCRIPTION"]);
      const qty = Number(String(r["QUANTITY"] || "0").replace(/,/g, ""));
      const amount = cleanAmount(
        r["TOTAL CHARGES"] ??
          r["TOTAL CHARGES "] ??
          r["TOTAL CHARGES_1"] ??
          r["TOTAL"]
      );

      if (!orderNo) continue;
      if (!desc) continue;

      const tariffId = descLookup.get(desc);

      if (!tariffId) {
        skipped.push({
          blnum: orderNo,
          description: r["DESCRIPTION"],
          reason: "No description mapping",
        });
        continue;
      }

      const tariff = tariffLookup.get(tariffId);

      if (!tariff) {
        skipped.push({
          blnum: orderNo,
          description: r["DESCRIPTION"],
          tariff_id: tariffId,
          reason: "No tariff mapping",
        });
        continue;
      }

      if (!grouped[orderNo]) grouped[orderNo] = [];

      grouped[orderNo].push({
        tariff_id: tariffId,
        charge_id: tariff.charge_id,
        description: tariff.description,
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
      terminal,
      raw_rows: rows.length,
      count: preview.length,
      skipped_count: skipped.length,
      preview,
      skipped,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}