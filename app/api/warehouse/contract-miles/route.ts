import { NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";

export const GET = withStaffAccess(async () => {
  const { data, error } = await staffDatabase().from("inbound_contract_miles")
    .select("customer_code,pickup_city,pickup_state,delivery_code,miles,locked_order_count")
    .order("customer_code").order("pickup_state").order("pickup_city").order("delivery_code");
  if (error) return NextResponse.json({ error: "Could not load contract miles." }, { status: 503 });
  return NextResponse.json({ rows: data }, { headers: { "Cache-Control": "private, no-store" } });
});
