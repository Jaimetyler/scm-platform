import { warehouseWallTime } from "../inbound/checkin/mcleod-time.ts";
import type { draftHoustonOrder } from "./pilot.ts";

type Draft = ReturnType<typeof draftHoustonOrder>;

export function unitedAgPilotPayload(draft: Draft) {
  if (draft.salesOrder !== "2601730" || draft.order.blnum !== "C0437 90 BALES" || draft.baleCount !== 90 ||
      draft.order.equipment_type_id !== "V" || draft.order.stops.length !== 2 ||
      draft.order.stops[0].location_id !== "UNITELTX" || draft.order.stops[1].location_id !== "SUPPBAT1" ||
      draft.order.stops[0].sched_arrive_early !== "2026-11-11T07:00:00" ||
      draft.order.stops[0].sched_arrive_late !== "2026-11-11T16:00:00" ||
      draft.order.stops[1].sched_arrive_early !== "2026-11-12T07:00:00" ||
      draft.order.stops[1].sched_arrive_late !== "2026-11-12T20:00:00")
    return null;
  return {
    ...draft.order,
    rate_type: "F",
    stops: draft.order.stops.map(({ timezone, ...stop }) => {
      if (timezone !== "America/Chicago") throw Error("Pilot stop timezone changed.");
      const stamp = (value: string) => warehouseWallTime(value.slice(0, 10), Number(value.slice(11, 13)), Number(value.slice(14, 16)), "HOU");
      return { ...stop, sched_arrive_early: stamp(stop.sched_arrive_early), sched_arrive_late: stamp(stop.sched_arrive_late) };
    }),
  };
}

type Payload = NonNullable<ReturnType<typeof unitedAgPilotPayload>>;
function instant(value: unknown) {
  const raw = String(value ?? "");
  const iso = raw.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-]\d{4})$/, "$1-$2-$3T$4:$5:$6$7");
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? Date.parse(iso) : NaN;
}

export function verifyUnitedAgPilot(actual: Record<string, unknown>, id: string, expected: Payload) {
  const fields = ["company_id", "status", "customer_id", "revenue_code_id", "commodity_id",
    "order_type_id", "order_mode", "ordered_by", "equipment_type_id", "blnum", "consignee_refno",
    "rate_type"] as const;
  const mismatches: string[] = fields.filter(field => String(actual[field] ?? "").trim() !== expected[field]);
  if (String(actual.id ?? "").trim() !== id) mismatches.push("id");
  const stops = Array.isArray(actual.stops) ? actual.stops : [];
  if (stops.length !== expected.stops.length) mismatches.push("stop count");
  for (const stop of expected.stops) {
    const matches = stops.filter(row => Number(row?.order_sequence) === stop.order_sequence);
    const [saved] = matches;
    if (matches.length !== 1 || !saved?.id || saved.stop_type !== stop.stop_type || saved.location_id !== stop.location_id ||
        instant(saved.sched_arrive_early) !== instant(stop.sched_arrive_early) ||
        instant(saved.sched_arrive_late) !== instant(stop.sched_arrive_late))
      mismatches.push(`stop ${stop.order_sequence}`);
  }
  return mismatches;
}
