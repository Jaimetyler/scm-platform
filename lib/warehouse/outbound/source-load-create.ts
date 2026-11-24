import { warehouseWallTime } from "../../inbound/checkin/mcleod-time.ts";
import type { previewToyoSourceLoads } from "./source-loads.ts";

type Preview = ReturnType<typeof previewToyoSourceLoads>;

export function sourceLoadPayload(preview: Preview, line: Preview["lines"][number], pickup: { early: string; late: string }, enteredCutoff: string) {
  const draft = line.mcleodDraft;
  if (!draft || !line.readyDate || !preview.cutoff || !preview.docCutoff)
    throw Error("Resolve the dispatch review issues before creating this order.");
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const cutoffTime = preview.cutoff.slice(11, 16) || enteredCutoff;
  if (!clock.test(cutoffTime)) throw Error("Enter the confirmed loaded-return cutoff time (Houston local time).");
  const cutoffDay = preview.cutoff.slice(0, 10);
  if (!clock.test(pickup.early) || !clock.test(pickup.late) || pickup.early >= pickup.late ||
      `${line.readyDate}T${pickup.late}` >= `${cutoffDay}T${cutoffTime}`)
    throw Error("The pickup window must end before the loaded-return cutoff.");
  // The inbound cotton flow uses Eastern transport offsets for local wall-clock schedules.
  const stamp = (day: string, time: string) => warehouseWallTime(day, Number(time.slice(0, 2)), Number(time.slice(3, 5)), "SAV");
  const scheduled = [
    [stamp(line.readyDate, pickup.early), stamp(line.readyDate, pickup.late)],
    [stamp(line.readyDate, pickup.late), stamp(cutoffDay, cutoffTime)],
  ];
  return {
    ...draft, __type: "orders", company_id: "TMS", status: "A", order_mode: "T", collection_method: "T",
    doc_cutoff_date: stamp(preview.docCutoff.slice(0, 10), preview.docCutoff.slice(11, 16) || "00:00"),
    cutoff_date: stamp(cutoffDay, cutoffTime),
    stops: draft.stops.map((stop, index) => ({
      ...stop, __type: "stop", __name: "stops", company_id: "TMS", status: "A",
      sched_arrive_early: scheduled[index][0], sched_arrive_late: scheduled[index][1],
    })),
  };
}

function wallClock(value: unknown) {
  const date = String(value ?? "").trim();
  return /^\d{14}/.test(date) ? date.slice(0, 14) : date.slice(0, 19).replace(/\D/g, "");
}

export function verifySourceLoad(actual: Record<string, unknown>, expected: ReturnType<typeof sourceLoadPayload>) {
  for (const field of ["company_id", "customer_id", "revenue_code_id", "order_type_id", "equipment_type_id", "blnum", "consignee_refno", "booking_no_sucm", "ssl_sucm", "planning_comment", "rate_type"] as const) {
    if (String(actual[field] ?? "").trim() !== expected[field]) throw Error(`McLeod read-back differs on ${field}.`);
  }
  for (const field of ["rate", "rate_units", "weight"] as const) {
    if (Number(actual[field]) !== expected[field]) throw Error(`McLeod read-back differs on ${field}.`);
  }
  const cents = (value: unknown) => value == null || String(value).trim() === "" ? NaN : Math.round(Number(value) * 100);
  const chargeRows = actual.otherCharges ?? actual.other_charges ?? actual.otherCharge;
  const fuelCents = Array.isArray(chargeRows)
    ? chargeRows.filter(charge => ["FSC", "HFS"].includes(String(charge?.charge_id ?? "").trim().toUpperCase()))
      .reduce((total, charge) => total + cents(charge.amount), 0)
    : 0;
  if (!Number.isFinite(fuelCents) || fuelCents < 0 ||
      cents(actual.total_charge) !== cents(expected.total_charge) + fuelCents)
    throw Error("McLeod total does not match the platform base rate plus itemized fuel surcharge.");
  for (const field of ["doc_cutoff_date", "cutoff_date"] as const) {
    if (wallClock(actual[field]) !== wallClock(expected[field])) throw Error(`McLeod read-back differs on ${field}.`);
  }
  if (expected.ordered_by && String(actual.ordered_by ?? "").trim() !== expected.ordered_by)
    throw Error("McLeod read-back differs on Ordered By.");
  const stops = actual.stops;
  if (!Array.isArray(stops) || stops.length !== 2 || expected.stops.some(stop => !stops.some(saved =>
    saved?.id && Number(saved.order_sequence) === stop.order_sequence && saved.stop_type === stop.stop_type &&
    saved.location_id === stop.location_id && wallClock(saved.sched_arrive_early) === wallClock(stop.sched_arrive_early) &&
    wallClock(saved.sched_arrive_late) === wallClock(stop.sched_arrive_late))))
    throw Error("McLeod read-back differs on pickup or loaded return.");
}
