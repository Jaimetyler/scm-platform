import type { draftHoustonOrder } from "./pilot.ts";

type Draft = ReturnType<typeof draftHoustonOrder>;

const approvedOrders = new Map([
  ["2601771", { blnum: "NX005 91 BALES", weight: 44667, equipment: "V",
    pickups: ["MOODGAT4", "MOODGAT3"], pickupDate: "2026-11-10", hours: ["08:00", "15:00"], deliveryDate: "2026-11-11" }],
  ["2601967", { blnum: "E1316 90 BALES", weight: 44125, equipment: "V",
    pickups: ["MOODGAT4"], pickupDate: "2026-11-10", hours: ["08:00", "15:00"], deliveryDate: "2026-11-11" }],
  ["2601968", { blnum: "EH020 90 BALES", weight: 43902, equipment: "VT",
    pickups: ["GULFCOT2"], pickupDate: "2026-11-10", hours: ["08:00", "16:00"], deliveryDate: "2026-11-11" }],
  ["2601996", { blnum: "BZ042 91 BALES", weight: 44976, equipment: "VT",
    pickups: ["TAYLTAT1"], pickupDate: "2026-11-11", hours: ["08:00", "16:00"], deliveryDate: "2026-11-12" }],
  ["2601997", { blnum: "E1318 90 BALES", weight: 44425, equipment: "VT",
    pickups: ["GULFCOT2"], pickupDate: "2026-11-11", hours: ["08:00", "16:00"], deliveryDate: "2026-11-12" }],
]);

export function houstonPilotPayload(draft: Draft) {
  const approved = approvedOrders.get(draft.salesOrder);
  if (!approved || draft.order.blnum !== approved.blnum ||
      draft.order.equipment_type_id !== approved.equipment || draft.order.weight !== approved.weight)
    return null;
  const expectedStops = [
    ...approved.pickups.map(code => [code, `${approved.pickupDate}T${approved.hours[0]}:00`, `${approved.pickupDate}T${approved.hours[1]}:00`]),
    ["SUPPBAT1", `${approved.deliveryDate}T07:00:00`, `${approved.deliveryDate}T20:00:00`],
  ];
  if (draft.order.stops.length !== expectedStops.length ||
      draft.order.stops.some((stop, index) => {
        const [location, early, late] = expectedStops[index];
        return stop.location_id !== location || stop.sched_arrive_early !== early || stop.sched_arrive_late !== late;
      })) return null;
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
  if (expected.weight !== undefined && Number(actual.weight) !== expected.weight) mismatches.push("weight");
  if (String(actual.id ?? "").trim() !== id) mismatches.push("id");
  const stops = Array.isArray(actual.stops) ? actual.stops : [];
  if (stops.length !== expected.stops.length) mismatches.push("stop count");
  for (const stop of expected.stops) {
    const matches = stops.filter(row => Number(row?.order_sequence) === stop.order_sequence);
    const [saved] = matches;
    if (matches.length !== 1 || !saved?.id || saved.stop_type !== stop.stop_type || saved.location_id !== stop.location_id ||
        localClock(saved.sched_arrive_early) !== localClock(stop.sched_arrive_early) ||
        localClock(saved.sched_arrive_late) !== localClock(stop.sched_arrive_late))
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

export function isArrivalFormatRejection(salesOrder: string, audit: {
  status: string; mcleod_order_id: string | null; error_message: string | null;
  reviewed_payload: { payload?: { stops?: { sched_arrive_early?: string }[] }; previousAttempt?: unknown } | null;
}) {
  return salesOrder === "2601887" && audit.status === "creation_uncertain" && audit.mcleod_order_id === null &&
    audit.error_message === "McLeod create returned HTTP 406. The stop at MOODGAT3 in GALVESTON, TX 77551 must have a scheduled early arrival date and time" &&
    audit.reviewed_payload?.payload?.stops?.[0]?.sched_arrive_early === "2026-11-12T08:00:00" &&
    !audit.reviewed_payload.previousAttempt;
}

export function matchCorrectedSchedule(payload: Payload, example: Record<string, unknown>): Payload {
  if (example?.id !== "0829475" || String(example.ordered_by ?? "").trim() !== "2601887" ||
      example.customer_id !== payload.customer_id || example.blnum !== "TA004 89 BALES" ||
      !Array.isArray(example.stops) || example.stops.length !== 2)
    throw Error("McLeod order 0829475 could not be verified as the schedule reference.");
  const pickup = example.stops.find(stop => Number(stop?.order_sequence) === 1);
  const delivery = example.stops.find(stop => Number(stop?.order_sequence) === 2);
  const early = String(pickup?.sched_arrive_early ?? "").trim();
  const late = String(pickup?.sched_arrive_late ?? "").trim();
  const offset = early.match(/^\d{14}([+-]\d{4})$/)?.[1];
  if (pickup?.stop_type !== "PU" || pickup.location_id !== "MOODGAT3" ||
      delivery?.stop_type !== "SO" || delivery.location_id !== "SUPPBAT1" ||
      !offset || !/^\d{14}[+-]\d{4}$/.test(late) || late.slice(-5) !== offset ||
      localClock(early) !== "2026-11-12T08:00:00" || localClock(late) !== "2026-11-12T15:00:00")
    throw Error(`The verified pilot's pickup clock times could not be reused. McLeod returned ${early || "blank"} and ${late || "blank"}.`);
  // The pilot and reference stops are in Central time in the same week, after the DST transition.
  const encode = (wallTime: string) => wallTime.replace(/[-:T]/g, "") + offset;
  return { ...payload, stops: payload.stops.map(stop => ({
    ...stop, sched_arrive_early: encode(stop.sched_arrive_early), sched_arrive_late: encode(stop.sched_arrive_late),
  })) };
}
