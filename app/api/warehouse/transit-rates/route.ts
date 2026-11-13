import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx/xlsx.mjs";
import { staffActor, staffProfile, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { normalizeTransitRate } from "@/lib/dray/transit-rates";

const fields = "id,account_code,account_name,pickup_city,pickup_state,delivery_code,flat_cents,updated_at";
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
function side(req: NextRequest) {
  const value = req.nextUrl.searchParams.get("side");
  if (value !== "customer" && value !== "carrier") return null;
  if (value === "carrier" && staffProfile(req)?.role !== "admin") return null;
  return value;
}

export const GET = withStaffAccess(async (req: NextRequest) => {
  const rateSide = side(req);
  if (!rateSide) return fail("Rate category unavailable.", 403);
  const rates = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await staffDatabase().from("inbound_transit_rates").select(fields).eq("rate_side", rateSide)
      .order("account_code").order("pickup_city").order("id").range(offset, offset + 999);
    if (result.error) return fail("Could not load transit rates.", 503);
    rates.push(...result.data);
    if (result.data.length < 1000) return NextResponse.json({ rates }, { headers: { "Cache-Control": "private, no-store" } });
  }
});

export const POST = withStaffAccess(async (req: NextRequest) => {
  const rateSide = side(req);
  if (!rateSide) return fail("Rate category unavailable.", 403);
  let rows: Record<string, unknown>[];
  let id: string | undefined;
  let version: string | undefined;
  const importing = req.headers.get("content-type")?.startsWith("multipart/form-data");
  try {
    if (importing) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File) || file.size > 2_000_000 || !/\.(csv|xlsx)$/i.test(file.name)) throw Error("Choose a CSV or XLSX file up to 2 MB.");
      const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", raw: true, sheetRows: 502 });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
      if (!rows.length || rows.length > 500) throw Error("Include 1 to 500 rates on the first sheet.");
    } else {
      const body = await req.json();
      rows = [body.rate];
      id = body.id;
      version = body.version;
      if (id !== undefined && (!/^[a-f0-9-]{36}$/i.test(id) || !version || !Number.isFinite(Date.parse(version)))) throw Error("Reload this rate before editing.");
    }
    const keys = new Set<string>();
    const values = rows.map((row, index) => {
      try {
        const rate = normalizeTransitRate(row ?? {});
        const key = JSON.stringify([rate.account_code, rate.pickup_city, rate.pickup_state, rate.delivery_code]);
        if (keys.has(key)) throw Error("This account and route appear more than once.");
        keys.add(key);
        return { ...rate, rate_side: rateSide, updated_by: staffActor(req), updated_at: new Date().toISOString() };
      } catch (error) {
        throw Error(`Rate row ${index + 1}: ${(error as Error).message}`);
      }
    });
    const table = staffDatabase().from("inbound_transit_rates");
    const write = id ? table.update(values[0]).eq("id", id).eq("rate_side", rateSide).eq("updated_at", version)
      : table.insert(values);
    const { data, error } = await write.select(fields);
    if (error?.code === "23505" || (!error && !data?.length)) return fail("A matching rate already exists or was edited. Reload the grid and use Edit for existing rates.", 409);
    if (error) return fail("Could not save transit rates.", 503);
    return NextResponse.json({ rates: data });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid transit rate.");
  }
});
