import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHECKIN_SITES } from "@/lib/inbound/checkin/sites";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    const { id, lineId } = await context.params;
    const body = await req.json();
    const terminal = String(body.terminal ?? "").toUpperCase(), siteCode = String(body.siteCode ?? "");
    if (![id, lineId].every((value) => /^[0-9a-f-]{36}$/i.test(value)) ||
      !CHECKIN_SITES.some((site) => site.terminal === terminal && site.siteCode === siteCode && site.materials.includes("cotton")))
      return NextResponse.json({ ok: false, error: "Unknown booking, mark, or warehouse" }, { status: 400 });
    if (!["hold", "resume", "cancel", "warehouse", "keep_source"].includes(body.action) ||
      typeof body.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(body.expectedUpdatedAt)) ||
      typeof body.note !== "string" || body.note.length > 500)
      return NextResponse.json({ ok: false, error: "Reload the booking and enter a valid action and note" }, { status: 400 });
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variables");
    let actor = "warehouse user";
    try { actor = atob(req.headers.get("authorization")?.slice(6) ?? "").split(":")[0] || actor; } catch { /* Staff session name is optional. */ }
    const { error } = await createClient(url, key).rpc("change_cotton_outbound_mark", {
      p_booking_id: id, p_line_id: lineId, p_terminal: terminal, p_site_code: siteCode,
      p_expected_updated_at: body.expectedUpdatedAt, p_action: body.action, p_note: body.note, p_changed_by: actor,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (reason) {
    return NextResponse.json({ ok: false, error: reason instanceof Error ? reason.message : "Could not change booking mark" }, { status: 500 });
  }
}
