import { dependencyFetch } from "@/lib/http/dependency";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { cottonShortage, type ShortageFields } from "./shortage";

type Row = ShortageFields & {
  id: string;
  created_at: string;
  checked_in_at: string | null;
  verified_at: string | null;
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
  matched_order_id?: string | null;
  matched_stop_id?: string | null;
  mcleod_lookup_attempt_id: string;
  mcleod_lookup_has_known_match?: boolean;
};

function database() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key, { global: { fetch: dependencyFetch } });
}

export async function processCheckinRow(req: NextRequest, id: string, restartedRow?: Row) {
  const sb = database();
  const claim = restartedRow ? { data: [restartedRow], error: null }
    : await sb.rpc("claim_inbound_checkin_row_v2", { p_id: id });
  if (claim.error) throw claim.error;
  const row = (claim.data as Row[] | null)?.[0];
  if (!row) {
    const { data } = await sb.from("inbound_checkin_rows").select("*").eq("id", id).single();
    return data;
  }

  try {
    if (cottonShortage(row)) throw new Error("Bale shortage - cannot post McLeod delivery");
    const response = await fetch(new URL("/api/inbound/sync", req.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
        authorization: req.headers.get("authorization") ?? "",
        origin: req.headers.get("origin") ?? "",
      },
      body: JSON.stringify({
        checkinId: id,
        lookupAttemptId: row.mcleod_lookup_attempt_id,
        row: {
          receivedDate: row.received_date,
          mark: row.mark,
          shipper: row.shipper,
          bolBC: String(row.bol_bc ?? ""),
          balesUnloaded: row.bale_count,
          expectedBaleCount: row.expected_bale_count,
          location: row.warehouse_location,
          sourceSheet: row.sub_location,
          terminal: row.terminal,
          siteCode: row.site_code,
          equipmentType: row.equipment_type,
          source: "live_checkin",
          checkedInAt: row.checked_in_at,
          verifiedAt: row.verified_at,
        },
      }),
      cache: "no-store",
    });
    const result = await response.json();
    const live = process.env.MCLEOD_SYNC_ENABLED === "true";
    const completed = response.ok && result.ok === true && live &&
      result.mode !== "safe" && result.mcleodResponse?.ok !== false;
    const outsideCarrier = response.ok && result.ok === true &&
      result.skipped === true && result.outsideCarrier === true &&
      !result.matchedOrderId && !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match;
    const skipped = response.ok && result.ok === true && result.skipped === true && !result.outsideCarrier;
    const status = outsideCarrier ? "outside_carrier" : completed || skipped ? "processed" : "failed";
    const message = outsideCarrier || completed || skipped
      ? null
      : result.error ? String(result.error)
      : !live || result.mode === "safe"
      ? "McLeod sync is in preview mode. No delivery was posted."
      : String(result.reason ?? "McLeod processing failed");
    const lookupFailure = result.lookupFailure;
    const typedLookupFailure = status === "failed" && lookupFailure?.phase === "lookup" &&
      lookupFailure.attemptId === row.mcleod_lookup_attempt_id &&
      ["SEARCH_LIMIT_REACHED", "LOOKUP_UNAVAILABLE", "LOOKUP_INCOMPLETE"].includes(lookupFailure.code) &&
      ["MCLEOD_LOOKUP_UNRESOLVED", "MCLEOD_LOOKUP_CONFLICT"].includes(result.code);
    const unresolved = typedLookupFailure && result.code === "MCLEOD_LOOKUP_UNRESOLVED" &&
      lookupFailure.hasKnownMatches === false && !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match;
    const { data, error } = await sb.from("inbound_checkin_rows")
      .update({
        draft_status: status, mcleod_processing_result_id: row.mcleod_lookup_attempt_id,
        processed_at: status === "processed" || status === "outside_carrier"
          ? new Date().toISOString() : null,
        processing_error: message,
        // Never erase an already-known order/stop on a failed discovery or write.
        ...(result.matchedOrderId && !row.matched_order_id ? { matched_order_id: String(result.matchedOrderId) } : {}),
        ...(result.matchedOrderId || row.matched_order_id || row.matched_stop_id || lookupFailure?.hasKnownMatches
          ? { mcleod_lookup_has_known_match: true } : {}),
        ...(typedLookupFailure ? { mcleod_lookup_status: unresolved ? "unresolved" : "conflict",
          mcleod_lookup_failure_code: lookupFailure.code, mcleod_lookup_failed_at: new Date().toISOString() }
          : status === "failed" ? { mcleod_lookup_status: "error" }
          : { mcleod_lookup_status: outsideCarrier ? "no_match" : "matched", mcleod_processing_phase: "complete" }),
      })
      .eq("id", id).eq("draft_status", "processing").eq("mcleod_lookup_attempt_id", row.mcleod_lookup_attempt_id).select("*").single();
    if (error) throw error;
    return data;
  } catch (error) {
    const { data, error: updateError } = await sb.from("inbound_checkin_rows")
      .update({ draft_status: "failed", mcleod_processing_result_id: row.mcleod_lookup_attempt_id, mcleod_lookup_status: "error", processing_error: error instanceof Error ? error.message : "McLeod processing failed" })
      .eq("id", id).eq("draft_status", "processing").eq("mcleod_lookup_attempt_id", row.mcleod_lookup_attempt_id).select("*").single();
    if (updateError) throw updateError;
    return data;
  }
}
