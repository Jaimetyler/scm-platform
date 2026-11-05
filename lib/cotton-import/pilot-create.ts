import type { draftHoustonOrder } from "./pilot.ts";

type Draft = ReturnType<typeof draftHoustonOrder>;

export function houstonPilotPayload(draft: Draft) {
  if (draft.salesOrder !== "2601887" || draft.order.blnum !== "TA004 89 BALES" || draft.baleCount !== 89 ||
      draft.order.equipment_type_id !== "V" || draft.order.stops.length !== 2 ||
      draft.order.stops[0].location_id !== "MOODGAT3" || draft.order.stops[1].location_id !== "SUPPBAT1" ||
      draft.order.stops[0].sched_arrive_early !== "2026-11-12T08:00:00" ||
      draft.order.stops[0].sched_arrive_late !== "2026-11-12T15:00:00" ||
      draft.order.stops[1].sched_arrive_early !== "2026-11-13T07:00:00" ||
      draft.order.stops[1].sched_arrive_late !== "2026-11-13T20:00:00")
    return null;
  return {
    ...draft.order,
    collection_method: "T",
    rate_type: "F",
    stops: draft.order.stops.map(({ timezone: _timezone, ...stop }) => stop),
  };
}

type Payload = NonNullable<ReturnType<typeof houstonPilotPayload>>;
function localClock(value: unknown) {
  const raw = String(value ?? "").trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:Z|[+-]\d{4})?$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}`;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  return iso ? `${iso[1]}T${iso[2]}` : null;
}

export function verifyHoustonPilot(actual: Record<string, unknown>, id: string, expected: Payload) {
  const fields = ["company_id", "status", "customer_id", "revenue_code_id", "commodity_id",
    "order_type_id", "order_mode", "ordered_by", "equipment_type_id", "blnum", "consignee_refno",
    "collection_method", "rate_type"] as const;
  const mismatches: string[] = fields.filter(field => String(actual[field] ?? "").trim() !== expected[field]);
  if (String(actual.id ?? "").trim() !== id) mismatches.push("id");
  const stops = Array.isArray(actual.stops) ? actual.stops : [];
  if (stops.length !== expected.stops.length) mismatches.push("stop count");
  for (const stop of expected.stops) {
    const matches = stops.filter(row => Number(row?.order_sequence) === stop.order_sequence);
    const [saved] = matches;
    if (matches.length !== 1 || !saved?.id || saved.stop_type !== stop.stop_type || saved.location_id !== stop.location_id ||
        localClock(saved.sched_arrive_early) !== stop.sched_arrive_early ||
        localClock(saved.sched_arrive_late) !== stop.sched_arrive_late)
      mismatches.push(`stop ${stop.order_sequence}`);
  }
  return mismatches;
}

export function isMissingCollectionMethodRejection(salesOrder: string, audit: {
  status: string; mcleod_order_id: string | null; error_message: string | null;
  reviewed_payload: { payload?: { collection_method?: unknown }; previousAttempt?: unknown } | null;
}) {
  return salesOrder === "2601780" && audit.status === "creation_uncertain" && audit.mcleod_order_id === null &&
    audit.error_message === "McLeod create returned HTTP 406. The field [collection_method] in table [orders] must be entered to post this record." &&
    Boolean(audit.reviewed_payload?.payload && audit.reviewed_payload.payload.collection_method === undefined &&
      !audit.reviewed_payload.previousAttempt);
}
