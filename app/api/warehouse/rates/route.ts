import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx/xlsx.mjs";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { normalizeServiceRate, rateColumns } from "@/lib/dray/service-rates";

export const runtime = "nodejs";
export const GET = withStaffAccess(async (_req: NextRequest) => {
  const { data, error } = await staffDatabase().from("customer_service_rates").select(["rate_code", ...rateColumns].join(","))
    .order("terminal").order("site_code").order("service_type").order("customer_code").order("revenue_code").limit(1000);
  if (error) return NextResponse.json({ ok: false, error: "Could not load rates." }, { status: 503 });
  return NextResponse.json({ ok: true, rates: data }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withStaffAccess(async (req: NextRequest) => {
  try {
    let input: unknown;
    let rateCode: number | undefined;
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File) || file.size > 2_000_000 || !/\.(csv|xlsx)$/i.test(file.name))
        throw Error("Choose a CSV or XLSX file under 2 MB.");
      const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", sheetRows: 502, raw: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      input = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    } else {
      const body = await req.json();
      input = body.rates;
      rateCode = body.rateCode;
      if (rateCode !== undefined && (!Number.isSafeInteger(rateCode) || rateCode <= 0 || !Array.isArray(input) || input.length !== 1))
        throw Error("Select one valid rate to edit.");
    }
    if (!Array.isArray(input) || input.length < 1 || input.length > 500) throw Error("Provide 1 to 500 rate rows.");
    const keys = new Set<string>();
    const rates = input.map((row, index) => {
      try {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw Error("Invalid row.");
        const rate = normalizeServiceRate(row);
        const key = [rate.terminal, rate.site_code, rate.customer_code, rate.revenue_code, rate.service_type, rate.return_location].join("|");
        if (keys.has(key)) throw Error("This rate scope appears twice.");
        keys.add(key);
        return rate;
      } catch (error) { throw Error(`Row ${index + 1}: ${error instanceof Error ? error.message : "Invalid rate."}`); }
    });
    const table = staffDatabase().from("customer_service_rates");
    if (rateCode !== undefined) {
      const { data, error } = await table.update(rates[0]).eq("rate_code", rateCode).select("rate_code").maybeSingle();
      if (error?.code === "23505") return NextResponse.json({ ok: false, error: "A rate already exists for that warehouse, customer, mode, revenue code, and return location." }, { status: 409 });
      if (error) return NextResponse.json({ ok: false, error: "Could not save rate. Try again." }, { status: 503 });
      if (!data) return NextResponse.json({ ok: false, error: "Rate not found. Refresh and try again." }, { status: 404 });
    } else {
      const { error } = await table.upsert(rates, {
        onConflict: "terminal,site_code,customer_code,revenue_code,service_type,return_location",
      });
      if (error) return NextResponse.json({ ok: false, error: "Could not save rates. Try again." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, count: rates.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid rate data." }, { status: 400 });
  }
});
