import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx/xlsx.mjs";
import { staffActor, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { getCheckinSite } from "@/lib/inbound/checkin/sites";
import { rateItems } from "@/lib/warehouse/outbound/carrier-rates";
import { carrierRateFields, parseCarrierRate, saveCarrierRate } from "@/lib/warehouse/outbound/carrier-rate-store";

export const POST = withStaffAccess(async (req: NextRequest) => {
  const site = getCheckinSite(req.nextUrl.searchParams.get("terminal") ?? "", req.nextUrl.searchParams.get("siteCode") ?? "");
  if (!site?.materials.includes("cotton")) {
    return NextResponse.json({ error: "Choose a cotton warehouse." }, { status: 400 });
  }
  const scope = { terminal: site.terminal, site_code: site.siteCode };
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) return saveCarrierRate(req, scope);
  let rates;
  try {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File) || !/\.(csv|xlsx)$/i.test(file.name) || file.size > 2_000_000) {
      throw Error("Choose a CSV or XLSX file under 2 MB.");
    }
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", sheetRows: 502, raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }) : [];
    if (!rows.length || rows.length > 500) throw Error("Include 1 to 500 rates on the first sheet.");
    rates = rows.map((row, index) => {
      try {
        return parseCarrierRate({ ...row, rates: Object.fromEntries(rateItems.map(({ key }) => [key, { pay: String(row[key] ?? "") }])) });
      } catch (error) {
        throw Error(`Data row ${index + 1}: ${(error as Error).message}`);
      }
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const { data, error } = await staffDatabase().from("outbound_carrier_rates")
    .insert(rates.map(rate => ({ ...rate, ...scope, updated_by: staffActor(req) }))).select(carrierRateFields);
  if (error?.code === "23505") {
    return NextResponse.json({ error: "Duplicate carrier ID and lane in the file or this yard. Remove duplicates and retry. No rates were imported." }, { status: 409 });
  }
  if (error) throw Error("Could not import carrier rates.");
  return NextResponse.json({ rates: data });
});
