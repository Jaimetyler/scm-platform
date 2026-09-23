import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

function requestUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return "warehouse user";
  try {
    return atob(auth.slice(6)).split(":")[0]?.trim() || "warehouse user";
  } catch {
    return "warehouse user";
  }
}

function validSite(terminal: string, siteCode: string) {
  return CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const terminal = String(searchParams.get("terminal") ?? "").trim().toUpperCase();
    const siteCode = String(searchParams.get("siteCode") ?? "").trim();
    if (!validSite(terminal, siteCode)) {
      return NextResponse.json({ ok: false, error: "Unknown warehouse site" }, { status: 400 });
    }

    const { data, error } = await database().from("container_gate_queue")
      .select("id, checked_in_at, driver_name, queue_status")
      .eq("terminal", terminal)
      .eq("site_code", siteCode)
      .eq("queue_status", "waiting")
      .order("checked_in_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, rows: data ?? [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load container line" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id ?? "").trim();
    const action = String(body?.action ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["complete", "cancel"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid queue action" }, { status: 400 });
    }

    const queueStatus = action === "complete" ? "completed" : "cancelled";
    const { data, error } = await database().from("container_gate_queue")
      .update({
        queue_status: queueStatus,
        completed_at: new Date().toISOString(),
        completed_by: requestUser(req),
      })
      .eq("id", id)
      .eq("queue_status", "waiting")
      .select("id, queue_status")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "This driver is no longer waiting" }, { status: 409 });
    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update container line" }, { status: 500 });
  }
}
