import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";

export const GET = withStaffAccess(async (request: NextRequest) => {
  const id = request.nextUrl.searchParams.get("location_id");
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "Choose a location." }, { status: 400 });
  const { data, error } = await staffDatabase().from("cotton_location_routing_miles")
    .select("delivery_code,miles,order_count").eq("location_id", id).order("delivery_code");
  if (error) return NextResponse.json({ error: "Could not load routing miles." }, { status: 503 });
  return NextResponse.json({ rows: data }, { headers: { "Cache-Control": "private, no-store" } });
});
