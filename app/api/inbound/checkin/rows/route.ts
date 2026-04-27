import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  draft_status: "draft" | "ready" | "processed";
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
      query = query.eq("received_date", date);
    }

    const { data, error } = await query
      .order("draft_status", { ascending: true })
      .order("received_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: (data ?? []) as CheckinRow[],
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

    if (!terminal || !site_code || !site_name) {
      return NextResponse.json(
        { ok: false, error: "terminal, siteCode, and siteName are required" },
        { status: 400 }
      );
    }

    const requestedEquipment = normalizeEquipmentType(body?.equipmentType);
    const defaultEquipment: EquipmentType =
      requestedEquipment ?? (terminal === "SAV" ? "V" : null);

    const insertPayload = {
      terminal,
      site_code,
      site_name,
      sub_location,
      received_date,
      mark: null,
      shipper: null,
      bol_bc: null,
      bale_count: null,
      warehouse_location: null,
      equipment_type: defaultEquipment,
      verified: false,
      comment_1: null,
      comment_2: null,
      draft_status: "draft" as const,
      processed_at: null,
    };

    const { data, error } = await sb
      .from("inbound_checkin_rows")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: data as CheckinRow,
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