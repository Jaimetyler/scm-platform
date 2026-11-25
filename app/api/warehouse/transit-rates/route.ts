import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";

export const GET = withStaffAccess(async () => {
  const db = staffDatabase();
  const pageSize = 500;
  const rates = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("inbound_transit_rates_with_miles")
      .select("customer_code,pickup_city,pickup_state,delivery_city,delivery_state,delivery_code,base_rate,order_type,fuel_code,contract_miles,pickup_codes")
      .order("customer_code").order("pickup_state").order("pickup_city").order("delivery_state").order("delivery_city")
      .range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: "Could not load transit rates." }, { status: 503 });
    rates.push(...data);
    if (data.length < pageSize) break;
  }
  return NextResponse.json({ rates }, { headers: { "Cache-Control": "private, no-store" } });
});
