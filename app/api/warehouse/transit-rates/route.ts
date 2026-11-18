import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";

export const GET = withStaffAccess(async () => {
  const { data, error } = await staffDatabase().from("inbound_transit_rates_with_miles")
    .select("customer_code,pickup_city,pickup_state,delivery_city,delivery_state,delivery_code,base_rate,order_type,fuel_code,contract_miles,pickup_codes")
    .order("customer_code").order("pickup_state").order("pickup_city").order("delivery_state").order("delivery_city");
  if (error) return NextResponse.json({ error: "Could not load transit rates." }, { status: 503 });
  return NextResponse.json({ rates: data }, { headers: { "Cache-Control": "private, no-store" } });
});

const laneFields = ["pickup_city", "pickup_state", "delivery_city", "delivery_state"] as const;

export const POST = withStaffAccess(async request => {
  const body = await request.json().catch(() => null);
  const code = typeof body?.delivery_code === "string" ? body.delivery_code.trim().toUpperCase() : "";
  if (!body || !/^[A-Z0-9_-]{1,30}$/.test(code) ||
      !laneFields.every(field => typeof body[field] === "string" && body[field].length > 0 && body[field].length <= 100)) {
    return NextResponse.json({ error: "Enter a McLeod delivery code for an LDC lane." }, { status: 400 });
  }
  let update = staffDatabase().from("inbound_transit_rates").update({ delivery_code: code }).eq("customer_code", "ALLECOTN");
  for (const field of laneFields) update = update.eq(field, body[field]);
  const { data, error } = await update.select("delivery_code").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not save the delivery code." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "LDC lane not found." }, { status: 404 });
  return NextResponse.json(data);
});
