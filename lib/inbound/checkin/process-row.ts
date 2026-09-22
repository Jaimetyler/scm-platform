import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

type Row = {
  id: string;
  terminal: string;
  site_code: string;
  sub_location: string;
  received_date: string;
  mark: string;
  shipper: string;
  bol_bc: number | null;
  bale_count: number;
  warehouse_location: string;
  equipment_type: string;
  draft_status: string;
  verified: boolean;
};

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key);
}

export async function processCheckinRow(req: NextRequest, id: string) {
  const sb = database();
  const { data: claimed, error: claimError } = await sb
    .rpc("claim_inbound_checkin_row", { p_id: id });
  if (claimError) throw claimError;
  const row = (claimed as Row[] | null)?.[0];
  if (!row) {
    const { data } = await sb.from("inbound_checkin_rows").select("*").eq("id", id).single();
    return data;
  }

  try {
    const response = await fetch(new URL("/api/inbound/sync", req.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
        authorization: req.headers.get("authorization") ?? "",
      },
      body: JSON.stringify({
        row: {
          receivedDate: row.received_date,
          mark: row.mark,
          shipper: row.shipper,
          bolBC: String(row.bol_bc ?? ""),
          balesUnloaded: row.bale_count,
          location: row.warehouse_location,
          sourceSheet: row.sub_location,
          terminal: row.terminal,
          equipmentType: row.equipment_type,
        },
      }),
      cache: "no-store",
    });
    const result = await response.json();
    const live = process.env.MCLEOD_SYNC_ENABLED === "true";
    const completed = response.ok && result.ok === true && live &&
      result.mode !== "safe" && result.mcleodResponse?.ok !== false;
    const skipped = response.ok && result.skipped === true;
    const status = completed || skipped ? "processed" : "failed";
    const message = completed || skipped
      ? null
      : !live || result.mode === "safe"
      ? "McLeod sync is in preview mode. No delivery was posted."
      : String(result.error ?? result.reason ?? "McLeod processing failed");
    const { data, error } = await sb.from("inbound_checkin_rows")
      .update({
        draft_status: status,
        processed_at: status === "processed" ? new Date().toISOString() : null,
        processing_error: message,
        matched_order_id: result.matchedOrderId ? String(result.matchedOrderId) : null,
      })
      .eq("id", id).eq("draft_status", "processing").select("*").single();
    if (error) throw error;
    return data;
  } catch (error) {
    const { data, error: updateError } = await sb.from("inbound_checkin_rows")
      .update({ draft_status: "failed", processing_error: error instanceof Error ? error.message : "McLeod processing failed" })
      .eq("id", id).eq("draft_status", "processing").select("*").single();
    if (updateError) throw updateError;
    return data;
  }
}
