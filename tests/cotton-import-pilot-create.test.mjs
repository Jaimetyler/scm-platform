import test from "node:test";
import assert from "node:assert/strict";
import { draftHoustonOrder } from "../lib/cotton-import/pilot.ts";
import { houstonPilotPayload, isMissingCollectionMethodRejection, verifyHoustonPilot } from "../lib/cotton-import/pilot-create.ts";

test("Houston pilot is scoped to the reviewed order and verifies the saved McLeod stops", () => {
  const source = { salesOrder: "2601887", mark: "TA004", bales: 89, pickups: [{ bales: 89 }] };
  const preview = {
    customerId: "BUNGOMNE", revenueCode: "MAIN", commodity: "COTTON", deliveryLocation: "SUPPBAT1",
    blnum: "TA004 89 BALES", pickupStops: [{ locationCode: "MOODGAT3", scheduledDate: "2026-11-12", timezone: "America/Chicago" }],
  };
  const draft = draftHoustonOrder(source, preview, [{ early: "08:00", late: "15:00" }], "V");
  assert.equal(houstonPilotPayload({ ...draft, salesOrder: "2601780" }), null);
  const payload = houstonPilotPayload(draft);
  assert.equal(payload.stops[0].sched_arrive_early, "2026-11-12T08:00:00");
  assert.equal(payload.stops[1].sched_arrive_late, "2026-11-13T20:00:00");
  assert.equal(payload.collection_method, "T");
  assert.equal(payload.rate_type, "F");
  assert.equal(payload.rate_units, undefined);
  assert.equal(payload.rate, undefined);
  const actual = { ...payload, id: "1234567", stops: payload.stops.map((stop, i) => ({ ...stop, id: String(i + 1) })) };
  assert.deepEqual(verifyHoustonPilot(actual, actual.id, payload), []);
  actual.stops[0].sched_arrive_early = "20261112080000-0500";
  assert.deepEqual(verifyHoustonPilot(actual, actual.id, payload), []);
  actual.stops[0].sched_arrive_early = "20261112090000-0500";
  assert.deepEqual(verifyHoustonPilot(actual, actual.id, payload), ["stop 1"]);
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
