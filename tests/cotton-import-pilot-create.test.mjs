import test from "node:test";
import assert from "node:assert/strict";
import { draftHoustonOrder } from "../lib/cotton-import/pilot.ts";
import { unitedAgPilotPayload, verifyUnitedAgPilot } from "../lib/cotton-import/pilot-create.ts";

test("United Ag pilot is scoped to the reviewed order and verifies the saved McLeod stops", () => {
  const source = { salesOrder: "2601730", mark: "C0437", bales: 90, pickups: [{ bales: 90 }] };
  const preview = {
    customerId: "BUNGOMNE", revenueCode: "MAIN", commodity: "COTTON", deliveryLocation: "SUPPBAT1",
    blnum: "C0437 90 BALES", pickupStops: [{ locationCode: "UNITELTX", scheduledDate: "2026-11-11", timezone: "America/Chicago" }],
  };
  const draft = draftHoustonOrder(source, preview, [{ early: "07:00", late: "16:00" }], "V");
  assert.equal(unitedAgPilotPayload({ ...draft, salesOrder: "2601968" }), null);
  const payload = unitedAgPilotPayload(draft);
  assert.equal(payload.stops[0].sched_arrive_early, "20261111070000-0600");
  assert.equal(payload.stops[1].sched_arrive_late, "20261112200000-0600");
  assert.equal(payload.rate, undefined);
  const actual = { ...payload, id: "1234567", stops: payload.stops.map((stop, i) => ({ ...stop, id: String(i + 1) })) };
  assert.deepEqual(verifyUnitedAgPilot(actual, actual.id, payload), []);
  actual.stops[1].sched_arrive_late = "20261112150000-0600";
  assert.deepEqual(verifyUnitedAgPilot(actual, actual.id, payload), ["stop 2"]);
});
