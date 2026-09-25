import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";

const ACTIVE = ["waiting", "called", "in_door", "working"] as const;
const NEXT: Record<string, string[]> = {
  waiting: ["called", "cancelled"],
  called: ["in_door", "waiting", "cancelled"],
  in_door: ["working", "called", "cancelled"],
  working: ["completed", "in_door", "cancelled"],
};
const TIMESTAMP: Record<string, string> = {
  called: "yard_called_at", in_door: "yard_in_door_at",
  working: "yard_work_started_at", completed: "yard_completed_at",
  cancelled: "yard_completed_at",
};

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

function siteExists(terminal: string, siteCode: string) {
  return CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode);
}

function user(req: NextRequest) {
  try { return atob(req.headers.get("authorization")?.slice(6) ?? "").split(":")[0] || "warehouse user"; }
  catch { return "warehouse user"; }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const terminal = String(searchParams.get("terminal") ?? "").toUpperCase();
    const siteCode = String(searchParams.get("siteCode") ?? "");
    if (!siteExists(terminal, siteCode)) return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });

    const { data, error } = await database().from("inbound_checkin_rows")
      .select("id,checked_in_at,driver_name,driver_phone,movement_direction,material_type,reference_number,destination,mark,bol_bc,draft_status,bol_photo_path,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at")
      .eq("terminal", terminal).eq("site_code", siteCode).eq("checkin_source", "driver_qr")
      .in("yard_status", [...ACTIVE]).order("checked_in_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, rows: (data ?? []).map(({ bol_photo_path, ...row }) => ({ ...row, has_bol_photo: Boolean(bol_photo_path) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load domestic queue" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id ?? "");
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? "");
    const terminal = String(body?.terminal ?? "").toUpperCase();
    const siteCode = String(body?.siteCode ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || !siteExists(terminal, siteCode) || !NEXT[from]?.includes(to)) {
      return NextResponse.json({ ok: false, error: "Invalid queue transition" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { data, error } = await database().from("inbound_checkin_rows")
      .update({ yard_status: to, [TIMESTAMP[to]]: now, yard_updated_by: user(req) })
      .eq("id", id).eq("terminal", terminal).eq("site_code", siteCode)
      .eq("checkin_source", "driver_qr").eq("yard_status", from)
      .select("id,yard_status,yard_called_at,yard_in_door_at,yard_work_started_at,yard_completed_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "This arrival changed. Refresh the queue." }, { status: 409 });
    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update domestic queue" }, { status: 500 });
  }
}
