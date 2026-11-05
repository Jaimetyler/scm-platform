import test from "node:test";
import assert from "node:assert/strict";
import { draftHoustonOrder } from "../lib/cotton-import/pilot.ts";
import { houstonPilotPayload, isMissingCollectionMethodRejection, matchCorrectedSchedule, verifyHoustonPilot } from "../lib/cotton-import/pilot-create.ts";

test("two-pickup pilot sends combined weight and verifies all three stops", () => {
  const source = { salesOrder: "2601771", mark: "NX005", bales: 91, pickups: [
    { bales: 53, weight: 26087 }, { bales: 38, weight: 18580 },
  ] };
  const preview = {
    customerId: "BUNGOMNE", revenueCode: "MAIN", commodity: "COTTON", deliveryLocation: "SUPPBAT1",
    blnum: "NX005 91 BALES",
    pickupStops: ["MOODGAT4", "MOODGAT3"].map(locationCode => ({
      locationCode, scheduledDate: "2026-11-10", timezone: "America/Chicago",
    })),
  };
  const draft = draftHoustonOrder(source, preview, Array(2).fill({ early: "08:00", late: "15:00" }), "V");
  assert.equal(houstonPilotPayload({ ...draft, salesOrder: "2601887" }), null);
  const payload = houstonPilotPayload(draft);
  assert.equal(payload.weight, 44667);
  assert.equal(payload.collection_method, "T");
  assert.equal(payload.rate_type, "F");
  assert.equal(payload.rate, undefined);
  const example = { id: "0829475", ordered_by: "2601887", customer_id: "BUNGOMNE", blnum: "TA004 89 BALES",
    stops: [
      { order_sequence: 1, stop_type: "PU", location_id: "MOODGAT3", sched_arrive_early: "20261112080000-0500", sched_arrive_late: "20261112150000-0500" },
      { order_sequence: 2, stop_type: "SO", location_id: "SUPPBAT1" },
    ],
  };
  const matched = matchCorrectedSchedule(payload, example);
  assert.deepEqual(matched.stops.map(stop => stop.sched_arrive_early), [
    "20261110080000-0500", "20261110080000-0500", "20261111070000-0500",
  ]);
  const actual = { ...matched, id: "1234567", stops: matched.stops.map((stop, i) => ({ ...stop, id: String(i + 1) })) };
  assert.deepEqual(verifyHoustonPilot(actual, actual.id, matched), []);
  actual.weight = 26087;
  actual.stops[1].sched_arrive_early = "20261110090000-0500";
  assert.deepEqual(verifyHoustonPilot(actual, actual.id, matched), ["weight", "stop 2"]);
});

test("only the recorded missing-field rejection can be corrected once", () => {
  const rejected = {
    status: "creation_uncertain", mcleod_order_id: null,
    error_message: "McLeod create returned HTTP 406. The field [collection_method] in table [orders] must be entered to post this record.",
    reviewed_payload: { payload: {} },
  };
  assert.equal(isMissingCollectionMethodRejection("2601780", rejected), true);
  assert.equal(isMissingCollectionMethodRejection("2601730", rejected), false);
  assert.equal(isMissingCollectionMethodRejection("2601780", { ...rejected, error_message: "timeout" }), false);
  assert.equal(isMissingCollectionMethodRejection("2601780", {
    ...rejected, reviewed_payload: { payload: { collection_method: "T" }, previousAttempt: rejected },
  }), false);
});
