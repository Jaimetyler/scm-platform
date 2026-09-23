import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid check-in identifier" }, { status: 400 });
    }

    const sb = database();
    const { data: row, error } = await sb.from("inbound_checkin_rows")
      .select("bol_photo_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!row?.bol_photo_path) {
      return NextResponse.json({ ok: false, error: "No paperwork photo is attached to this check-in" }, { status: 404 });
    }

    const { data, error: signedError } = await sb.storage
      .from("driver-bol-documents")
      .createSignedUrl(row.bol_photo_path, 60);
    if (signedError || !data?.signedUrl) throw signedError ?? new Error("Could not open paperwork photo");

    return NextResponse.redirect(data.signedUrl, 302);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not open paperwork photo",
    }, { status: 500 });
  }
}
