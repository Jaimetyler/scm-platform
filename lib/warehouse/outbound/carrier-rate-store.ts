import { NextRequest, NextResponse } from "next/server";
import { staffActor } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { parseRates } from "./carrier-rates";

export const carrierRateFields = "id,carrier_id,carrier_name,lane,rates,updated_at";

export function listCarrierRates(scope: { terminal: string; site_code: string }) {
  return staffDatabase().from("outbound_carrier_rates").select(carrierRateFields)
    .match(scope).order("carrier_name").order("lane");
}

export function parseCarrierRate(body: Record<string, unknown>) {
  const carrierId = String(body.carrierId ?? "").trim().toUpperCase();
  const carrierName = String(body.carrierName ?? "").trim();
  const lane = String(body.lane ?? "").trim();
  if (!/^[A-Z0-9_-]{1,30}$/.test(carrierId) || !carrierName || carrierName.length > 100 || !lane || lane.length > 100) {
    throw Error("Enter the McLeod carrier ID, carrier name, and lane.");
  }
  return { carrier_id: carrierId, carrier_name: carrierName, lane, rates: parseRates(body.rates as Parameters<typeof parseRates>[0]) };
}

export async function saveCarrierRate(req: NextRequest, scope: { terminal: string; site_code: string }) {
  const body = await req.json();
  let rate;
  try {
    rate = parseCarrierRate(body ?? {});
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const warehouse = { terminal: scope.terminal, site_code: scope.site_code };
  const values = { ...warehouse, ...rate, updated_by: staffActor(req), updated_at: new Date().toISOString() };
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
