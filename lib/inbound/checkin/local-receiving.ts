// Explicit business configuration, never inferred from failed McLeod searches.
// Keep aliases exact: similarly named customers must still use normal discovery.
export function isLocalReceivingCustomer(customer: unknown): boolean {
  return String(customer ?? "").trim().replace(/\s+/g, " ").toUpperCase() === "KING RANCH";
}

export function configuredLocalReceiving(row: {
  shipper?: unknown; matched_order_id?: unknown; matched_stop_id?: unknown;
  mcleod_lookup_has_known_match?: boolean; mcleod_processing_phase?: string | null;
  draft_status?: string | null; mcleod_lookup_attempt_id?: unknown; outside_carrier_override_at?: unknown;
}): boolean {
  return isLocalReceivingCustomer(row.shipper) && !row.matched_order_id && !row.matched_stop_id &&
    !row.mcleod_lookup_has_known_match && !row.outside_carrier_override_at &&
    (!row.mcleod_processing_phase || row.mcleod_processing_phase === "lookup") &&
    ["draft", "checked_in", "ready", "failed"].includes(row.draft_status ?? "") &&
    (row.draft_status !== "failed" || Boolean(row.mcleod_lookup_attempt_id));
}
