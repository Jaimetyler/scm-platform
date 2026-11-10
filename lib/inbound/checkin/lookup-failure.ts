/** Only a failed, read-only discovery may offer the staff outside-carrier path. */
export class McleodLookupIncompleteError extends Error {
  readonly code: "SEARCH_LIMIT_REACHED" | "LOOKUP_UNAVAILABLE" | "LOOKUP_INCOMPLETE";
  readonly hasKnownMatches: boolean;
  constructor(message: string, hasKnownMatches: boolean, reasons: string[]) {
    super(message);
    this.hasKnownMatches = hasKnownMatches;
    this.name = "McleodLookupIncompleteError";
    this.code = reasons.some(reason => reason.includes("result limit")) ? "SEARCH_LIMIT_REACHED"
      : reasons.some(reason => /network|timeout|HTTP|response body/i.test(reason)) ? "LOOKUP_UNAVAILABLE" : "LOOKUP_INCOMPLETE";
  }
}

export type OutsideCarrierLookupRow = {
  draft_status?: string | null; material_type?: string | null; movement_direction?: string | null;
  yard_status?: string | null; checked_in_at?: string | null;
  matched_order_id?: string | null; matched_stop_id?: string | null;
  mcleod_lookup_status?: string | null; mcleod_lookup_attempt_id?: string | null;
  mcleod_lookup_failure_code?: string | null; mcleod_lookup_failed_at?: string | null;
  mcleod_processing_phase?: string | null; mcleod_lookup_has_known_match?: boolean; outside_carrier_override_at?: string | null;
};

export function outsideCarrierOverrideEligible(row: OutsideCarrierLookupRow | null | undefined): boolean {
  return Boolean(row && row.material_type === "cotton" && row.movement_direction === "delivery" &&
    row.draft_status === "failed" && row.checked_in_at &&
    ["waiting", "called", "in_door", "working"].includes(row.yard_status ?? "") &&
    !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match && !row.outside_carrier_override_at &&
    row.mcleod_processing_phase === "lookup" && row.mcleod_lookup_status === "unresolved" &&
    row.mcleod_lookup_attempt_id && row.mcleod_lookup_failed_at &&
    ["SEARCH_LIMIT_REACHED", "LOOKUP_UNAVAILABLE", "LOOKUP_INCOMPLETE"].includes(row.mcleod_lookup_failure_code ?? ""));
}

// Exact server-owned v1 error with a proven throw before any McLeod write. This
// permits only a fresh v2 lookup; it can never directly authorize an override.
export const LEGACY_PREWRITE_CAP_ERROR = "McLeod search incomplete (result limit reached); cannot classify outside carrier. Review McLeod search logs.";
export function canPrepareMcleodLookup(row: OutsideCarrierLookupRow & { processing_error?: string | null }): boolean {
  if (["write_pending", "legacy_processing"].includes(row.mcleod_processing_phase ?? "")) return false;
  if ((row.draft_status === "failed" && !row.mcleod_lookup_attempt_id) || row.mcleod_processing_phase === "legacy_review") {
    return row.draft_status === "failed" && row.processing_error === LEGACY_PREWRITE_CAP_ERROR &&
      !row.matched_order_id && !row.matched_stop_id && !row.mcleod_lookup_has_known_match;
  }
  return ["draft", "checked_in", "ready", "failed"].includes(row.draft_status ?? "") && !row.outside_carrier_override_at;
}
