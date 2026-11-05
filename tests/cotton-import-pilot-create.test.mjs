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
  assert.deepEqual(payload.otherCharges.map(c => [c.charge_id, c.units, c.rate, c.amount]), [["006", 1, 50, 50]]);
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
  assert.deepEqual(verifyHoustonPilot({ ...actual, otherCharges: [] }, actual.id, matched), ["Stop Off Charge 006"]);
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

test("the remaining Baytown orders allow the expected workbook weight and equipment", () => {
  const orders = [
    ["2601730", "C0437", 90, 43865, "UNITELTX", "2026-11-11", "16:00", "V"],
    ["2601967", "E1316", 90, 44125, "MOODGAT4", "2026-11-10", "15:00", "V"],
    ["2601968", "EH020", 90, 43902, "GULFCOT2", "2026-11-10", "16:00", "VT"],
    ["2601996", "BZ042", 91, 44976, "TAYLTAT1", "2026-11-11", "16:00", "VT"],
    ["2601997", "E1318", 90, 44425, "GULFCOT2", "2026-11-11", "16:00", "VT"],
  ];
  for (const [salesOrder, mark, bales, weight, locationCode, scheduledDate, late, equipment] of orders) {
    const draft = draftHoustonOrder({ salesOrder, mark, bales, pickups: [{ bales, weight }] }, {
      customerId: "BUNGOMNE", revenueCode: "MAIN", commodity: "COTTON", deliveryLocation: "SUPPBAT1",
      blnum: `${mark} ${bales} BALES`, pickupStops: [{ locationCode, scheduledDate, timezone: "America/Chicago" }],
    }, [{ early: salesOrder === "2601730" ? "07:00" : "08:00", late }], equipment);
    assert.equal(houstonPilotPayload(draft).weight, weight);
    assert.equal(houstonPilotPayload(draft).otherCharges, undefined);
    assert.equal(houstonPilotPayload({ ...draft, order: { ...draft.order, weight: undefined } }), null);
  }
});
