import { NextRequest, NextResponse } from "next/server";
import { staffActor, withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { readBookingCustomerRate } from "@/lib/dray/booking-customer-rate";
import { parseRates } from "@/lib/warehouse/outbound/carrier-rates";

const fields = "id,carrier_id,carrier_name,lane,rates,updated_at";
type Context = { params: Promise<{ id: string }> };

async function bookingScope({ params }: Context) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const { data, error } = await staffDatabase().from("cotton_outbound_bookings")
    .select("terminal,site_code,customer,return_location,return_location_code").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load booking.");
  return data;
}

export const GET = withStaffAccess(async (_req: NextRequest, context: Context) => {
  const scope = await bookingScope(context);
  if (!scope) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  const db = staffDatabase();
  const [{ data, error }, customerRate] = await Promise.all([
    db.from("outbound_carrier_rates").select(fields).match({ terminal: scope.terminal, site_code: scope.site_code }).order("carrier_name").order("lane"),
    readBookingCustomerRate(db, scope),
  ]);
  if (error) throw new Error("Could not load carrier rates.");
  const cents = (value: number | null) => value == null ? null : Math.round(Number(value) * 100);
  const customerBilling = customerRate ? {
    base: customerRate.fuel_mode === "all_in" ? cents(customerRate.base_rate) : null,
    chassisDays: cents(customerRate.chassis_daily_rate), chassisSplits: cents(customerRate.chassis_split_rate),
    stopoffs: cents(customerRate.stopoff_rate),
  } : null;
  return NextResponse.json({ rates: data, customerBilling }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withStaffAccess(async (req: NextRequest, context: Context) => {
  const scope = await bookingScope(context);
  if (!scope) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
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
  const { data, error } = await write.select(fields).maybeSingle();
  if (error?.code === "23505" || !error && !data) {
    return NextResponse.json({ error: "This rate already exists or has changed. Reload the rates and try again." }, { status: 409 });
  }
  if (error) throw new Error("Could not save carrier rate.");
  return NextResponse.json({ rate: data });
});
