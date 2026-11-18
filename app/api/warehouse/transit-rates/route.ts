import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";

export const GET = withStaffAccess(async () => {
  const { data, error } = await staffDatabase().from("inbound_transit_rates_with_miles")
    .select("customer_code,pickup_city,pickup_state,delivery_city,delivery_state,base_rate,order_type,fuel_code,contract_miles")
    .order("customer_code").order("pickup_state").order("pickup_city").order("delivery_state").order("delivery_city");
  if (error) return NextResponse.json({ error: "Could not load transit rates." }, { status: 503 });
  return NextResponse.json({ rates: data }, { headers: { "Cache-Control": "private, no-store" } });
});
