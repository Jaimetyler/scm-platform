import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyGateLocation, warehouseDate } from "@/lib/inbound/checkin/geofence";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

function clean(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function equipment(value: unknown): "V" | "F" | null {
  const normalized = clean(value, 20).toUpperCase();
  if (normalized === "V") return "V";
  if (normalized === "F") return "F";
  return null;
}

async function getGate(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await database().from("driver_checkin_sites")
    .select("id, terminal, site_code, site_name, latitude, longitude, radius_m, active")
    .eq("public_token", token).eq("active", true).maybeSingle();
  if (!data || data.latitude === null || data.longitude === null) return null;
  return data as {
    id: string; terminal: "SAV" | "HOU"; site_code: string; site_name: string;
    latitude: number; longitude: number; radius_m: number; active: boolean;
  };
}

export async function GET(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const gate = await getGate(token);
    if (!gate) return NextResponse.json({ ok: false, error: "This driver check-in link is not active" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      site: { terminal: gate.terminal, siteCode: gate.site_code, siteName: gate.site_name },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load this check-in site" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const gate = await getGate(token);
    if (!gate) return NextResponse.json({ ok: false, error: "This driver check-in link is not active" }, { status: 404 });

    const body = await req.json();
    const clientId = clean(body?.clientId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
      return NextResponse.json({ ok: false, error: "Invalid check-in identifier" }, { status: 400 });
    }

    const driverName = clean(body?.driverName).toUpperCase();
    const truckingCompany = clean(body?.truckingCompany).toUpperCase();
    const driverPhone = clean(body?.driverPhone, 40);
    const mark = clean(body?.mark).toUpperCase();
    const shipper = clean(body?.shipper).toUpperCase();
    const bolBC = positiveInteger(body?.bolBC);
    const baleCount = positiveInteger(body?.baleCount);
    const equipmentType = equipment(body?.equipmentType);
    if (!driverName || !truckingCompany || !mark || !shipper || !bolBC || !baleCount || !equipmentType) {
      return NextResponse.json({ ok: false, error: "Complete every required field before checking in" }, { status: 400 });
    }

    const latitude = Number(body?.location?.latitude);
    const longitude = Number(body?.location?.longitude);
    const accuracyMeters = Number(body?.location?.accuracyMeters);
    const capturedAt = clean(body?.location?.capturedAt, 40);
    const locationResult = verifyGateLocation({
      gate: { latitude: gate.latitude, longitude: gate.longitude, radiusMeters: gate.radius_m },
      driver: { latitude, longitude, accuracyMeters, capturedAt },
    });
    if (!locationResult.ok) {
      return NextResponse.json({ ok: false, error: locationResult.error }, { status: 403 });
    }

    const checkedInAt = new Date();
    const insertPayload = {
      id: clientId,
      terminal: gate.terminal,
      site_code: gate.site_code,
      site_name: gate.site_name,
      sub_location: "MAIN",
      received_date: warehouseDate(checkedInAt, gate.terminal),
      mark,
      shipper,
      bol_bc: bolBC,
      bale_count: baleCount,
      warehouse_location: null,
      equipment_type: equipmentType,
      verified: false,
      comment_1: clean(body?.comment, 500) || null,
      comment_2: null,
      draft_status: "checked_in",
      processed_at: null,
      checked_in_at: checkedInAt.toISOString(),
      checkin_source: "driver_qr",
      driver_checkin_site_id: gate.id,
      driver_name: driverName,
      driver_phone: driverPhone || null,
      trucking_company: truckingCompany,
      driver_latitude: latitude,
      driver_longitude: longitude,
      driver_accuracy_m: accuracyMeters,
      driver_distance_m: locationResult.distanceMeters,
      gate_location_verified_at: checkedInAt.toISOString(),
    };

    const sb = database();
    const { data, error } = await sb.from("inbound_checkin_rows").insert(insertPayload)
      .select("id, terminal, site_code, site_name, checked_in_at").single();
    if (error?.code === "23505") {
      const { data: existing } = await sb.from("inbound_checkin_rows")
        .select("id, terminal, site_code, site_name, checked_in_at")
        .eq("id", clientId).eq("driver_checkin_site_id", gate.id).maybeSingle();
      if (existing) return NextResponse.json({ ok: true, checkin: existing });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true, checkin: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Driver check-in failed" }, { status: 500 });
  }
}
