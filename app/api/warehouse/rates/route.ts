import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx/xlsx.mjs";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { normalizeServiceRate, rateColumns } from "@/lib/dray/service-rates";

export const runtime = "nodejs";
export const GET = withStaffAccess(async (_req: NextRequest) => {
  const { data, error } = await staffDatabase().from("customer_service_rates").select(rateColumns.join(","))
    .order("terminal").order("site_code").order("service_type").order("customer_code").order("revenue_code").limit(1000);
  if (error) return NextResponse.json({ ok: false, error: "Could not load rates." }, { status: 503 });
  return NextResponse.json({ ok: true, rates: data }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withStaffAccess(async (req: NextRequest) => {
  try {
    let input: unknown;
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File) || file.size > 2_000_000 || !/\.(csv|xlsx)$/i.test(file.name))
        throw Error("Choose a CSV or XLSX file under 2 MB.");
      const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", sheetRows: 502, raw: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      input = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    } else input = (await req.json()).rates;
    if (!Array.isArray(input) || input.length < 1 || input.length > 500) throw Error("Provide 1 to 500 rate rows.");
    const keys = new Set<string>();
    const rates = input.map((row, index) => {
      try {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw Error("Invalid row.");
        const rate = normalizeServiceRate(row);
        const key = [rate.terminal, rate.site_code, rate.customer_code, rate.revenue_code, rate.service_type].join("|");
        if (keys.has(key)) throw Error("This rate scope appears twice.");
        keys.add(key);
        return rate;
      } catch (error) { throw Error(`Row ${index + 1}: ${error instanceof Error ? error.message : "Invalid rate."}`); }
    });
    const { error } = await staffDatabase().from("customer_service_rates").upsert(rates, {
      onConflict: "terminal,site_code,customer_code,revenue_code,service_type",
    });
    if (error) return NextResponse.json({ ok: false, error: "Could not save rates. Try again." }, { status: 503 });
    return NextResponse.json({ ok: true, count: rates.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid rate data." }, { status: 400 });
  }
});
