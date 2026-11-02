import { NextRequest, NextResponse } from "next/server";
import { withStaffAccess } from "@/lib/auth/guard";
import { staffDatabase } from "@/lib/auth/session";
import { buildCottonOrderPreview, type CottonImportInput } from "@/lib/cotton-import/preview";
import type { CottonLocation } from "@/lib/cotton-import/location-resolution";

export const dynamic = "force-dynamic";

async function preview(req: NextRequest) {
  const body: unknown = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ ok: false, error: "Expected a cotton import preview request." }, { status: 400 });
  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.orders) || request.orders.length < 1 || request.orders.length > 500)
    return NextResponse.json({ ok: false, error: "Submit between 1 and 500 orders." }, { status: 400 });
  const db = staffDatabase();
  const { data, error } = await db.from("cotton_location_master")
    .select("id,mcleod_code,prev_code,name,timezone,active")
    .limit(5000);
  if (error || !data)
    return NextResponse.json({ ok: false, error: "Location master is unavailable; preview blocked." }, { status: 503 });
  const locations = data as CottonLocation[];
  const results = (request.orders as CottonImportInput[]).map((input, index) => {
    try {
      const order = buildCottonOrderPreview(input, locations);
      return { row: index + 1, status: "review_required" as const,
        reason: order.requiresScheduleReview
          ? "Pickup time must be verified before creation."
          : "Location and input validated; McLeod duplicate lookup and write approval are not yet connected.",
        order };
    } catch (e) {
      return { row: index + 1, status: "blocked" as const,
        reason: e instanceof Error ? e.message : "Invalid cotton import row." };
    }
  });
  return NextResponse.json({ ok: true, previewOnly: true, writesEnabled: false,
    totals: { submitted: results.length, blocked: results.filter(r => r.status === "blocked").length },
    results });
}

export const POST = withStaffAccess(preview);
