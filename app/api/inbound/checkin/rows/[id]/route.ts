import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processCheckinRow } from "@/lib/inbound/checkin/process-row";
import { buildPostDeliveryCorrection, isReadyCheckin, isCompleteCheckin } from "@/lib/inbound/checkin/ready";
import { publicCheckinRow } from "@/lib/inbound/checkin/public-row";
import { verifyCottonOrder } from "@/lib/inbound/checkin/verify-cotton-order";

import { cottonShortage, shortageAcknowledged, acknowledgeShortage, checkinActor, type ShortageFields } from "@/lib/inbound/checkin/shortage";

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

type CheckinRow = ShortageFields & {
  id: string;
  terminal: string;
  site_code: string;
  site_name: string;
  sub_location: string;
  received_date: string | null;
  mark: string | null;
  shipper: string | null;
  trucking_company?: string | null;
  bol_bc: number | null;
  bale_count: number | null;
  warehouse_location: string | null;
  equipment_type: "V" | "F" | null;
  verified: boolean;
  comment_1: string | null;
  comment_2: string | null;
  draft_status: "draft" | "checked_in" | "ready" | "processing" | "processed" | "outside_carrier" | "failed" | "delivery_blocked";
  processed_at: string | null;
  movement_direction?: "pickup" | "delivery" | null;
  material_type?: "cotton" | "lumber" | "other" | null;
  reference_number?: string | null;
  destination?: string | null;
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
      trucking_company: cleanText(body?.truckingCompany !== undefined ? body.truckingCompany : existing.trucking_company) || null,
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

    if (existing.draft_status === "delivery_blocked" &&
        ["terminal", "site_code", "site_name", "sub_location", "received_date", "mark", "shipper", "bol_bc", "bale_count", "warehouse_location", "equipment_type"].some((key) => merged[key] !== existing[key])) {
      return NextResponse.json({ ok: false, error: "Receiving is complete with a documented shortage. Add follow-up in Notes; the McLeod delivery remains blocked." }, { status: 409 });
    }

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
      return NextResponse.json({ ok: true, row: publicCheckinRow(data) });
    }

    const requestedOrderId = cleanText(body?.matchedOrderId);
    if ((merged.trucking_company?.length ?? 0) > 200) {
      return NextResponse.json({ ok: false, error: "Trucking company is too long" }, { status: 400 });
    }
    const identityChanged = existing.mark !== merged.mark || existing.bol_bc !== merged.bol_bc;
    const matchedOrderId = requestedOrderId || (identityChanged ? "" : cleanText(existing.matched_order_id));
    if (matchedOrderId && (identityChanged || matchedOrderId !== cleanText(existing.matched_order_id))) {
      merged.expected_bale_count = await verifyCottonOrder(matchedOrderId, merged.mark ?? "", merged.bol_bc);
    }

    if (identityChanged && !matchedOrderId) merged.expected_bale_count = null;
    const shortage = cottonShortage(merged);
    const at = new Date().toISOString();
    if (body?.acknowledgeShortage === true) {
      if (!body.expectedUpdatedAt) return NextResponse.json({ ok: false, error: "Reload before acknowledging a shortage" }, { status: 409 });
      if (shortageAcknowledged(merged)) return NextResponse.json({ ok: false, error: "The current shortage has already been acknowledged" }, { status: 409 });
      try { Object.assign(merged, acknowledgeShortage(merged, body.shortageNote, checkinActor(req.headers.get("authorization")), at));
        merged.comment_1 = [merged.comment_1, `Shortage acknowledged: ${shortage!.received} of ${shortage!.expected} bales. ${merged.shortage_note}`].filter(Boolean).join("\n"); }
      catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
    }
    if (body?.customerNotified === true) {
      if (!body.expectedUpdatedAt || !shortageAcknowledged(merged)) return NextResponse.json({ ok: false, error: "Acknowledge the current shortage before recording customer notification" }, { status: 400 });
      const followup = cleanText(body.notificationNote);
      if (!followup || followup.length > 2000) return NextResponse.json({ ok: false, error: "Enter a customer notification note (up to 2,000 characters)" }, { status: 400 });
      if (merged.customer_notified_at) return NextResponse.json({ ok: false, error: "Customer notification has already been recorded" }, { status: 409 });
      merged.customer_notified_at = at;
      merged.customer_notified_by = checkinActor(req.headers.get("authorization"));
      merged.comment_1 = [merged.comment_1, `Customer notified: ${followup}`].filter(Boolean).join("\n");
    }
    const draft_status = shortage && shortageAcknowledged(merged) && isCompleteCheckin(merged)
      ? "delivery_blocked" : isReadyCheckin(merged) ? "ready" : "checked_in";
    merged.verified = ["ready", "delivery_blocked"].includes(draft_status);
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
    const verified_at = merged.verified
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
      trucking_company: merged.trucking_company,
      matched_order_id: matchedOrderId || null,
      expected_bale_count: merged.expected_bale_count,
      shortage_acknowledged_at: merged.shortage_acknowledged_at,
      shortage_acknowledged_by: merged.shortage_acknowledged_by,
      shortage_expected_bales: merged.shortage_expected_bales,
      shortage_received_bales: merged.shortage_received_bales,
      shortage_note: merged.shortage_note,
      customer_notified_at: merged.customer_notified_at,
      customer_notified_by: merged.customer_notified_by,
      bol_bc: merged.bol_bc,
      bale_count: merged.bale_count,
      warehouse_location: merged.warehouse_location,
      equipment_type: merged.equipment_type,
      verified: merged.verified,
      comment_1: merged.comment_1,
      comment_2: merged.comment_2,
      draft_status,
      checked_in_at,
      yard_status: !existing.checked_in_at && checked_in_at ? "waiting" : existing.yard_status,
      verified_at,
      identity_corrected_at: identityCorrected ? new Date().toISOString() : existing.identity_corrected_at,
      processing_error: shortage ? "Bale shortage: McLeod delivery cannot be posted. Notify the customer and record follow-up in Notes." : null,
    };

    const { data, error } = await sb
      .from("inbound_checkin_rows")
      .update(updatePayload)
      .eq("id", id)
      .eq("updated_at", existing.updated_at)
      .in("draft_status", ["draft", "checked_in", "ready", "failed", "delivery_blocked"])
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
      row: publicCheckinRow(saved as unknown as Record<string, unknown>),
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
