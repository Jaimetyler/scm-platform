import { NextRequest, NextResponse } from "next/server";
import { staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { parseRates } from "./carrier-rates";

export const carrierRateFields = "id,carrier_id,carrier_name,lane,rates,updated_at";

export function listCarrierRates(scope: { terminal: string; site_code: string }) {
  return staffDatabase().from("outbound_carrier_rates").select(carrierRateFields)
    .match(scope).order("carrier_name").order("lane");
}

export async function saveCarrierRate(req: NextRequest, scope: { terminal: string; site_code: string }) {
  const body = await req.json();
  const carrierId = String(body?.carrierId ?? "").trim().toUpperCase();
  const carrierName = String(body?.carrierName ?? "").trim();
  const lane = String(body?.lane ?? "").trim();
  if (!/^[A-Z0-9_-]{1,30}$/.test(carrierId) || !carrierName || carrierName.length > 100 || !lane || lane.length > 100) {
    return NextResponse.json({ error: "Enter the McLeod carrier ID, carrier name, and lane." }, { status: 400 });
  }
  let rates;
  try {
    rates = parseRates(body?.rates);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const warehouse = { terminal: scope.terminal, site_code: scope.site_code };
  const values = { ...warehouse, carrier_id: carrierId, carrier_name: carrierName, lane, rates, updated_by: staffActor(req), updated_at: new Date().toISOString() };
  const table = staffDatabase().from("outbound_carrier_rates");
  const write = body.id
    ? table.update(values).match({ ...warehouse, id: body.id, updated_at: body.expectedUpdatedAt })
    : table.insert(values);
  const { data, error } = await write.select(carrierRateFields).maybeSingle();
  if (error?.code === "23505" || !error && !data) {
    return NextResponse.json({ error: "This rate already exists or has changed. Reload the rates and try again." }, { status: 409 });
  }
  if (error) throw new Error("Could not save carrier rate.");
  return NextResponse.json({ rate: data });
}
