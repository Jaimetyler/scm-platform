import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processCheckinRow } from "@/lib/inbound/checkin/process-row";

export const runtime = "nodejs";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(url, key);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEquipmentType(value: unknown): "V" | "F" | null {
  const raw = cleanText(value).toUpperCase();

  if (!raw) return null;
  if (raw === "V" || raw === "VAN" || raw.includes("VAN")) return "V";
  if (raw === "F" || raw === "FLAT" || raw === "FLATBED" || raw.includes("FLAT")) {
    return "F";
  }

  return null;
}

function normalizeSubLocation(value: unknown) {
  const raw = cleanText(value).toUpperCase();
  return raw || "MAIN";
}

function normalizePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;

  const n = Number(digits);
  if (!Number.isFinite(n)) return null;

  const intVal = Math.floor(n);
  return intVal > 0 ? intVal : null;
}

function normalizeDate(value: unknown): string | null {
  const raw = cleanText(value);
  return raw || null;
}

function isReadyRow(row: {
  terminal?: string | null;
  site_code?: string | null;
  site_name?: string | null;
  sub_location?: string | null;
  received_date?: string | null;
  mark?: string | null;
  shipper?: string | null;
  bale_count?: number | null;
  warehouse_location?: string | null;
  equipment_type?: string | null;
  verified?: boolean | null;
}) {
  return Boolean(
    cleanText(row.terminal) &&
      cleanText(row.site_code) &&
      cleanText(row.site_name) &&
      cleanText(row.sub_location) &&
      cleanText(row.received_date) &&
      cleanText(row.mark) &&
      cleanText(row.shipper) &&
      Number(row.bale_count ?? 0) > 0 &&
      cleanText(row.warehouse_location) &&
      cleanText(row.equipment_type) &&
      row.verified === true
  );
}

type CheckinRow = {
  id: string;
  terminal: string;
  site_code: string;
  site_name: string;
  sub_location: string;
  received_date: string | null;
  mark: string | null;
  shipper: string | null;
  bol_bc: number | null;
  bale_count: number | null;
  warehouse_location: string | null;
  equipment_type: "V" | "F" | null;
  verified: boolean;
  comment_1: string | null;
  comment_2: string | null;
  draft_status: "draft" | "checked_in" | "ready" | "processing" | "processed" | "failed";
  processed_at: string | null;
};

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const sb = getSupabase();
    const { id } = await context.params;
    const body = await req.json();

    const { data: existing, error: existingError } = await sb
      .from("inbound_checkin_rows")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json(
        { ok: false, error: existingError?.message || "Row not found" },
        { status: 404 }
      );
    }

    if (existing.draft_status === "processed" || existing.draft_status === "processing") {
      return NextResponse.json(
        { ok: false, error: "This row is processing or already processed" },
        { status: 409 }
      );
    }

    const merged: CheckinRow = {
      ...(existing as CheckinRow),
      terminal: cleanText(body?.terminal ?? existing.terminal).toUpperCase(),
      site_code: cleanText(body?.siteCode ?? existing.site_code),
      site_name: cleanText(body?.siteName ?? existing.site_name),
      sub_location: normalizeSubLocation(body?.subLocation ?? existing.sub_location),
      received_date: normalizeDate(body?.receivedDate !== undefined ? body.receivedDate : existing.received_date),
      mark: cleanText(body?.mark !== undefined ? body.mark : existing.mark).toUpperCase() || null,
      shipper: cleanText(body?.shipper !== undefined ? body.shipper : existing.shipper).toUpperCase() || null,
      bol_bc: normalizePositiveInteger(body?.bolBC !== undefined ? body.bolBC : existing.bol_bc),
      bale_count: normalizePositiveInteger(body?.baleCount !== undefined ? body.baleCount : existing.bale_count),
      warehouse_location:
        cleanText(body?.warehouseLocation !== undefined ? body.warehouseLocation : existing.warehouse_location).toUpperCase() || null,
      equipment_type: normalizeEquipmentType(
        body?.equipmentType !== undefined ? body.equipmentType : existing.equipment_type
      ),
      verified:
        typeof body?.verified === "boolean" ? body.verified : Boolean(existing.verified),
      comment_1: cleanText(body?.comment1 ?? existing.comment_1) || null,
      comment_2: cleanText(body?.comment2 ?? existing.comment_2) || null,
      draft_status: existing.draft_status,
      processed_at: existing.processed_at,
      id: existing.id,
    };

    const draft_status = isReadyRow(merged) ? "ready" : "checked_in";

    const updatePayload = {
      terminal: merged.terminal,
      site_code: merged.site_code,
      site_name: merged.site_name,
      sub_location: merged.sub_location,
      received_date: merged.received_date,
      mark: merged.mark,
      shipper: merged.shipper,
      bol_bc: merged.bol_bc,
      bale_count: merged.bale_count,
      warehouse_location: merged.warehouse_location,
      equipment_type: merged.equipment_type,
      verified: merged.verified,
      comment_1: merged.comment_1,
      comment_2: merged.comment_2,
      draft_status,
      processing_error: null,
    };

    const { data, error } = await sb
      .from("inbound_checkin_rows")
      .update(updatePayload)
      .eq("id", id)
      .in("draft_status", ["draft", "checked_in", "ready", "failed"])
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Row changed while saving. Refresh and try again." }, { status: 409 });
    }

    const saved = draft_status === "ready" ? await processCheckinRow(req, id) : data;
    return NextResponse.json({
      ok: true,
      row: saved as CheckinRow,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const sb = getSupabase();
    const { id } = await context.params;

    const { data, error } = await sb
      .from("inbound_checkin_rows")
      .delete()
      .eq("id", id)
      .in("draft_status", ["draft", "checked_in", "failed"])
      .select("id");

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    if (!data?.length) {
      return NextResponse.json(
        { ok: false, error: "This row is processing or already processed" },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
