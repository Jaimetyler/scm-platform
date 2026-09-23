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

const BOL_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BOL_PHOTO_BYTES = 4 * 1024 * 1024;

async function requestBody(req: NextRequest) {
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const photoValue = form.get("bolPhoto");
    return {
      body: {
        clientId: form.get("clientId"),
        checkinType: form.get("checkinType"),
        driverName: form.get("driverName"),
        driverPhone: form.get("driverPhone"),
        movementDirection: form.get("movementDirection"),
        materialType: form.get("materialType"),
        referenceNumber: form.get("referenceNumber"),
        destination: form.get("destination"),
        mark: form.get("mark"),
        bolBaleCount: form.get("bolBaleCount"),
        location: {
          latitude: form.get("latitude"),
          longitude: form.get("longitude"),
          accuracyMeters: form.get("accuracyMeters"),
          capturedAt: form.get("capturedAt"),
        },
      },
      photo: photoValue instanceof File && photoValue.size > 0 ? photoValue : null,
    };
  }
  return { body: await req.json(), photo: null as File | null };
}

function validatePhoto(photo: File | null) {
  if (!photo) return null;
  if (!BOL_PHOTO_TYPES.has(photo.type)) {
    return "The paperwork photo must be a JPG, PNG, or WebP image.";
  }
  if (photo.size > MAX_BOL_PHOTO_BYTES) {
    return "The paperwork photo is too large. Retake it at a lower resolution.";
  }
  return null;
}

function photoExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
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

    const { body, photo } = await requestBody(req);
    const clientId = clean(body?.clientId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
      return NextResponse.json({ ok: false, error: "Invalid check-in identifier" }, { status: 400 });
    }

    const checkinType = clean(body?.checkinType, 20).toLowerCase();
    const driverName = clean(body?.driverName).toUpperCase();
    if (!driverName || !["container", "domestic"].includes(checkinType)) {
      return NextResponse.json({ ok: false, error: "Choose a check-in type and enter the driver name" }, { status: 400 });
    }
    const driverPhone = clean(body?.driverPhone, 40);
    const movementDirection = clean(body?.movementDirection, 20).toLowerCase();
    const materialType = clean(body?.materialType, 20).toLowerCase();
    const referenceNumber = clean(body?.referenceNumber).toUpperCase();
    const destination = movementDirection === "pickup"
      ? clean(body?.destination, 200).toUpperCase()
      : null;
    const mark = materialType === "cotton" ? clean(body?.mark).toUpperCase() : null;
    const bolBaleCount = materialType === "cotton"
      ? positiveInteger(body?.bolBaleCount ?? body?.bolBC)
      : null;
    if (checkinType === "domestic" && (!driverPhone ||
        !["pickup", "delivery"].includes(movementDirection) ||
        !["cotton", "lumber", "other"].includes(materialType) ||
        !referenceNumber || (movementDirection === "pickup" && !destination) ||
        (materialType === "cotton" && (!mark || !bolBaleCount)))) {
      return NextResponse.json({ ok: false, error: "Complete every required field before checking in" }, { status: 400 });
    }
    if (checkinType === "domestic") {
      const photoError = validatePhoto(photo);
      if (photoError) return NextResponse.json({ ok: false, error: photoError }, { status: 400 });
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
    const sb = database();
    if (checkinType === "container") {
      const queuePayload = {
        id: clientId,
        driver_checkin_site_id: gate.id,
        terminal: gate.terminal,
        site_code: gate.site_code,
        site_name: gate.site_name,
        driver_name: driverName,
        checked_in_at: checkedInAt.toISOString(),
        driver_latitude: latitude,
        driver_longitude: longitude,
        driver_accuracy_m: accuracyMeters,
        driver_distance_m: locationResult.distanceMeters,
        location_verified_at: checkedInAt.toISOString(),
        queue_status: "waiting",
      };
      let { data, error } = await sb.from("container_gate_queue").insert(queuePayload)
        .select("id, checked_in_at").single();
      if (error?.code === "23505") {
        const existing = await sb.from("container_gate_queue")
          .select("id, checked_in_at").eq("id", clientId)
          .eq("driver_checkin_site_id", gate.id).maybeSingle();
        data = existing.data;
        error = existing.error;
      }
      if (error || !data) throw error ?? new Error("Could not join the container line");
      const positionResult = await sb.rpc("container_queue_position", { p_id: clientId });
      if (positionResult.error) throw positionResult.error;
      return NextResponse.json({
        ok: true,
        queue: true,
        position: Number(positionResult.data),
        checkedInAt: data.checked_in_at,
      });
    }

    const insertPayload = {
      id: clientId,
      terminal: gate.terminal,
      site_code: gate.site_code,
      site_name: gate.site_name,
      sub_location: "MAIN",
      received_date: warehouseDate(checkedInAt, gate.terminal),
      movement_direction: movementDirection,
      material_type: materialType,
      reference_number: referenceNumber,
      destination,
      mark,
      shipper: null,
      bol_bc: bolBaleCount,
      bale_count: null,
      warehouse_location: null,
      equipment_type: null,
      verified: false,
      comment_1: null,
      comment_2: null,
      draft_status: "checked_in",
      processed_at: null,
      checked_in_at: checkedInAt.toISOString(),
      checkin_source: "driver_qr",
      driver_checkin_site_id: gate.id,
      driver_name: driverName,
      driver_phone: driverPhone,
      trucking_company: null,
      driver_latitude: latitude,
      driver_longitude: longitude,
      driver_accuracy_m: accuracyMeters,
      driver_distance_m: locationResult.distanceMeters,
      gate_location_verified_at: checkedInAt.toISOString(),
    };

    let { data, error } = await sb.from("inbound_checkin_rows").insert(insertPayload)
      .select("id, terminal, site_code, site_name, checked_in_at").single();
    if (error?.code === "23505") {
      const { data: existing } = await sb.from("inbound_checkin_rows")
        .select("id, terminal, site_code, site_name, checked_in_at")
        .eq("id", clientId).eq("driver_checkin_site_id", gate.id).maybeSingle();
      if (existing) {
        data = existing;
        error = null;
      }
    }
    if (error) throw error;

    let photoSaved = false;
    if (photo) {
      const path = `${gate.terminal}/${gate.site_code}/${clientId}.${photoExtension(photo.type)}`;
      const { error: uploadError } = await sb.storage.from("driver-bol-documents")
        .upload(path, photo, { contentType: photo.type, upsert: true });
      if (!uploadError) {
        const { error: updateError } = await sb.from("inbound_checkin_rows").update({
          bol_photo_path: path,
          bol_photo_original_name: clean(photo.name, 200),
          bol_photo_content_type: photo.type,
          bol_photo_uploaded_at: new Date().toISOString(),
        }).eq("id", clientId).eq("driver_checkin_site_id", gate.id);
        photoSaved = !updateError;
      }
    }

    return NextResponse.json({ ok: true, checkin: data, photoSaved });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Driver check-in failed" }, { status: 500 });
  }
}
