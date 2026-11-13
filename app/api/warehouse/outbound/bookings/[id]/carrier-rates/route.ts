import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { readBookingCustomerRate } from "@/lib/dray/booking-customer-rate";
import { listCarrierRates, saveCarrierRate } from "@/lib/warehouse/outbound/carrier-rate-store";
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
    listCarrierRates({ terminal: scope.terminal, site_code: scope.site_code }),
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
  return saveCarrierRate(req, scope);
});
