import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processCheckinRow } from "@/lib/inbound/checkin/process-row";
import { buildPostDeliveryCorrection, isReadyCheckin } from "@/lib/inbound/checkin/ready";

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
  draft_status: "draft" | "checked_in" | "ready" | "processing" | "processed" | "outside_carrier" | "failed";
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

    const correctingProcessed = body?.correctionOnly === true && existing.draft_status === "processed";
    if (["processed", "outside_carrier", "processing"].includes(existing.draft_status) && !correctingProcessed) {
      return NextResponse.json(
        { ok: false, error: "This row is processing or already processed" },
        { status: 409 }
      );
    }
    if (body?.expectedUpdatedAt && body.expectedUpdatedAt !== existing.updated_at) {
      return NextResponse.json(
        { ok: false, error: "This row was changed in another browser. Reload to review it." },
        { status: 409 }
      );
    }
    if (body?.correctionOnly === true && !correctingProcessed) {
      return NextResponse.json({ ok: false, error: "Only processed rows can use this correction action" }, { status: 409 });
    }
    if (correctingProcessed && !body?.expectedUpdatedAt) {
      return NextResponse.json({ ok: false, error: "Reload this row before editing it" }, { status: 409 });
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
      verified: Boolean(existing.verified),
      comment_1: cleanText(body?.comment1 ?? existing.comment_1) || null,
      comment_2: cleanText(body?.comment2 !== undefined ? body.comment2 : existing.comment_2) || null,
      draft_status: existing.draft_status,
      processed_at: existing.processed_at,
      id: existing.id,
    };

    if (correctingProcessed) {
      let correction;
      try {
        correction = buildPostDeliveryCorrection(existing, merged, new Date().toISOString());
      } catch (error) {
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid correction" }, { status: 400 });
      }
      const { data, error } = await sb.from("inbound_checkin_rows")
        .update(correction)
        .eq("id", id)
        .eq("updated_at", existing.updated_at)
        .eq("draft_status", "processed")
        .select("*")
        .maybeSingle();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ ok: false, error: "Row changed while editing. Reload to review it." }, { status: 409 });
      return NextResponse.json({ ok: true, row: data as CheckinRow });
    }

    const draft_status = isReadyCheckin(merged) ? "ready" : "checked_in";
    merged.verified = draft_status === "ready";
    const identityCorrected = Boolean(existing.checked_in_at) && (
      existing.mark !== merged.mark || existing.shipper !== merged.shipper ||
      existing.bol_bc !== merged.bol_bc
    );
    const correctedAfterFailure = existing.draft_status === "failed" && (
      existing.mark !== merged.mark || existing.shipper !== merged.shipper ||
      existing.bale_count !== merged.bale_count ||
      existing.warehouse_location !== merged.warehouse_location ||
      existing.equipment_type !== merged.equipment_type ||
      existing.received_date !== merged.received_date
    );
    const verified_at = draft_status === "ready"
      ? !correctedAfterFailure && existing.verified_at
        ? existing.verified_at
        : new Date().toISOString()
      : null;
    const checked_in_at = existing.checked_in_at ??
      (merged.mark && merged.shipper && merged.bol_bc ? new Date().toISOString() : null);

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
      checked_in_at,
      verified_at,
      identity_corrected_at: identityCorrected ? new Date().toISOString() : existing.identity_corrected_at,
      processing_error: null,
    };

    const { data, error } = await sb
      .from("inbound_checkin_rows")
      .update(updatePayload)
      .eq("id", id)
      .eq("updated_at", existing.updated_at)
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
