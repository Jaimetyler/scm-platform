import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicCheckinRow } from "@/lib/inbound/checkin/public-row";

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

type EquipmentType = "V" | "F" | null;

function normalizeEquipmentType(value: unknown): EquipmentType {
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

function normalizeDate(value: unknown): string | null {
  const raw = cleanText(value);
  return raw || null;
}

function positiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

type CheckinRow = {
  id: string;
  created_at: string;
  updated_at: string;
  last_saved_at: string;
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
  equipment_type: EquipmentType;
  verified: boolean;
  comment_1: string | null;
  comment_2: string | null;
  draft_status: "checked_in" | "ready" | "processing" | "processed" | "outside_carrier" | "failed" | "draft";
  processed_at: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    const { searchParams } = new URL(req.url);

    const terminal = cleanText(searchParams.get("terminal")).toUpperCase();
    const siteCode = cleanText(searchParams.get("siteCode"));
    const date = cleanText(searchParams.get("date"));

    if (!terminal || !siteCode) {
      return NextResponse.json(
        { ok: false, error: "terminal and siteCode are required" },
        { status: 400 }
      );
    }

    let query = sb
      .from("inbound_checkin_rows")
      .select("*")
      .eq("terminal", terminal)
      .eq("site_code", siteCode);

    if (date) {
      // Carry unresolved rows forward and keep today's corrected processed
      // rows visible even when staff fixes their received date to another day.
      query = query.or(
        `received_date.eq.${date},draft_status.in.(checked_in,ready,processing,failed),updated_at.gte.${date}T00:00:00Z`
      );
    }

    const { data, error } = await query
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: ((data ?? []) as CheckinRow[]).filter((row) =>
        !(row.draft_status === "draft" && !row.mark && !row.shipper &&
          !row.bol_bc && !row.bale_count && !row.warehouse_location &&
          !row.comment_1 && !row.comment_2)
      ).map((row) => publicCheckinRow(row as unknown as Record<string, unknown>)),
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

export async function POST(req: NextRequest) {
  try {
    const sb = getSupabase();
    const body = await req.json();

    const terminal = cleanText(body?.terminal).toUpperCase();
    const site_code = cleanText(body?.siteCode);
    const site_name = cleanText(body?.siteName);
    const sub_location = normalizeSubLocation(body?.subLocation);
    const received_date = normalizeDate(body?.receivedDate);
    const mark = cleanText(body?.mark).toUpperCase();
    const shipper = cleanText(body?.shipper).toUpperCase();
    const clientId = cleanText(body?.clientId);

    if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
      return NextResponse.json({ ok: false, error: "Invalid check-in identifier" }, { status: 400 });
    }

    if (!terminal || !site_code || !site_name) {
      return NextResponse.json(
        { ok: false, error: "terminal, siteCode, and siteName are required" },
        { status: 400 }
      );
    }
    if (!mark || !shipper) {
      return NextResponse.json(
        { ok: false, error: "Enter a mark and customer before checking in" },
        { status: 400 }
      );
    }

    const requestedEquipment = normalizeEquipmentType(body?.equipmentType);
    const defaultEquipment: EquipmentType =
      requestedEquipment ?? (terminal === "SAV" ? "V" : null);

    const insertPayload = {
      ...(clientId ? { id: clientId } : {}),
      terminal,
      site_code,
      site_name,
      sub_location,
      received_date,
      mark,
      shipper,
      bol_bc: positiveInteger(body?.bolBC),
      bale_count: positiveInteger(body?.baleCount),
      warehouse_location: cleanText(body?.warehouseLocation).toUpperCase() || null,
      equipment_type: defaultEquipment,
      verified: false,
      comment_1: cleanText(body?.comment1) || null,
      comment_2: cleanText(body?.comment2) || null,
      draft_status: "checked_in" as const,
      processed_at: null,
      checked_in_at: positiveInteger(body?.bolBC) ? new Date().toISOString() : null,
    };

    const { data, error } = await sb
      .from("inbound_checkin_rows")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      // A timed-out first response may leave a saved row. Retrying the same
      // browser line returns it instead of making a duplicate check-in.
      if (error.code === "23505" && clientId) {
        const { data: existing } = await sb.from("inbound_checkin_rows")
          .select("*").eq("id", clientId).eq("terminal", terminal)
          .eq("site_code", site_code).single();
        if (existing) return NextResponse.json({ ok: true, row: publicCheckinRow(existing) });
      }
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: publicCheckinRow(data),
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
