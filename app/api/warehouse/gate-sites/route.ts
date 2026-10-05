import { withStaffAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
import { isValidLatitude, isValidLongitude } from "@/lib/inbound/checkin/geofence";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

async function GETHandler() {
  try {
    const { data, error } = await database().from("driver_checkin_sites")
      .select("id, terminal, site_code, site_name, public_token, latitude, longitude, radius_m, active, updated_at")
      .order("terminal").order("site_code");
    if (error) throw error;
    return NextResponse.json({ ok: true, sites: (data ?? []).filter((row) => CHECKIN_SITES.some((site) => site.terminal === row.terminal && site.siteCode === row.site_code)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load gate sites" }, { status: 500 });
  }
}

async function PUTHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const terminal = String(body?.terminal ?? "").trim().toUpperCase();
    const siteCode = String(body?.siteCode ?? "").trim();
    const site = CHECKIN_SITES.find((item) => item.terminal === terminal && item.siteCode === siteCode);
    if (!site) return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });

    const latitude = body?.latitude === null || body?.latitude === "" ? NaN : Number(body?.latitude);
    const longitude = body?.longitude === null || body?.longitude === "" ? NaN : Number(body?.longitude);
    const radiusM = Number(body?.radiusM);
    const active = body?.active === true;
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      return NextResponse.json({ ok: false, error: "Enter a valid gate latitude and longitude" }, { status: 400 });
    }
    if (!Number.isInteger(radiusM) || radiusM < 25 || radiusM > 5000) {
      return NextResponse.json({ ok: false, error: "The allowed radius must be between 25 and 5,000 meters" }, { status: 400 });
    }

    const values: Record<string, unknown> = {
      terminal,
      site_code: site.siteCode,
      site_name: site.siteName,
      latitude,
      longitude,
      radius_m: radiusM,
      active,
    };
    if (body?.rotateToken === true) values.public_token = crypto.randomUUID();

    const { data, error } = await database().from("driver_checkin_sites")
      .upsert(values, { onConflict: "terminal,site_code" })
      .select("id, terminal, site_code, site_name, public_token, latitude, longitude, radius_m, active, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, site: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save gate site" }, { status: 500 });
  }
}

export const GET = withStaffAccess(GETHandler);
export const PUT = withStaffAccess(PUTHandler);
