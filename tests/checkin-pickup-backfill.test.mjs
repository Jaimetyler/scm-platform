import assert from "node:assert/strict";
import test from "node:test";
import { planLiveDeliveryActuals } from "../lib/inbound/checkin/mcleod-time.ts";

function input(overrides = {}) {
  return { receivedDate: "2026-10-02", terminal: "SAV", checkedInAt: new Date("2026-10-02T14:12:00Z"),
    verifiedAt: new Date("2026-10-02T15:23:00Z"), pickups: [{ id: "PU" }], delivery: { id: "SO" }, ...overrides };
}

test("missing pickup gets previous-day 08:00/08:05; delivery keeps real event times", () => {
  const plan = planLiveDeliveryActuals(input());
  assert.equal(plan.pickup.arrivalDate, "20261001080000-0400");
  assert.equal(plan.pickup.departureDate, "20261001080500-0400");
  assert.equal(plan.pickup.generatedArrival, true);
  assert.equal(plan.pickup.generatedDeparture, true);
  assert.equal(plan.pickup.skipped, false);
  assert.equal(plan.delivery.arrivalDate, "20261002101200-0400");
  assert.equal(plan.delivery.departureDate, "20261002112300-0400");
});

test("Houston uses its own local date and offset, not UTC/server date", () => {
  const plan = planLiveDeliveryActuals(input({ terminal: "HOU", receivedDate: "2026-10-01",
    checkedInAt: new Date("2026-10-02T02:30:00Z"), verifiedAt: new Date("2026-10-02T03:00:00Z") }));
  assert.equal(plan.pickup.arrivalDate, "20260930080000-0500");
  assert.equal(plan.delivery.arrivalDate, "20261001213000-0500");
});

test("fallback uses the previous day's DST offset, including spring and fall", () => {
  for (const terminal of ["SAV", "HOU"]) {
    for (const [day, previous, offset] of [["2026-03-08", "20260307", terminal === "SAV" ? "-0500" : "-0600"],
      ["2026-03-09", "20260308", terminal === "SAV" ? "-0400" : "-0500"],
      ["2026-11-01", "20261031", terminal === "SAV" ? "-0400" : "-0500"],
      ["2026-11-02", "20261101", terminal === "SAV" ? "-0500" : "-0600"]]) {
      const plan = planLiveDeliveryActuals(input({ terminal, receivedDate: day,
        checkedInAt: new Date(`${day}T18:00:00Z`), verifiedAt: new Date(`${day}T19:00:00Z`) }));
      assert.equal(plan.pickup.arrivalDate, `${previous}080000${offset}`);
      assert.equal(plan.pickup.departureDate, `${previous}080500${offset}`);
    }
  }
});

test("calendar subtraction handles year changes and leap day", () => {
  for (const [day, previous] of [["2027-01-01", "20261231"], ["2028-03-01", "20280229"]]) {
    const plan = planLiveDeliveryActuals(input({ receivedDate: day,
      checkedInAt: new Date(`${day}T18:00:00Z`), verifiedAt: new Date(`${day}T19:00:00Z`) }));
    assert.ok(plan.pickup.arrivalDate.startsWith(previous + "080000"));
  }
});

test("all existing pickup actuals and a recorded delivery arrival are preserved", () => {
  const pickup = { id: "PU", actual_arrival: "20261001060000-0400", actual_departure: "20261001063000-0400" };
  const plan = planLiveDeliveryActuals(input({ pickups: [pickup], delivery: { id: "SO", actual_arrival: "20261002093000-0400" } }));
  assert.equal(plan.pickup.arrivalDate, pickup.actual_arrival);
  assert.equal(plan.pickup.departureDate, pickup.actual_departure);
  assert.equal(plan.pickup.skipped, true);
  assert.equal(plan.delivery.arrivalDate, "20261002093000-0400");
  assert.equal(plan.delivery.generatedArrival, false);
});

test("a partial pickup preserves its existing field and fills only the missing field", () => {
  const a = planLiveDeliveryActuals(input({ pickups: [{ id: "PU", actual_arrival: "20261001073000-0400" }] }));
  assert.equal(a.pickup.arrivalDate, "20261001073000-0400");
  assert.equal(a.pickup.departureDate, "20261001080500-0400");
  assert.equal(a.pickup.generatedArrival, false);
  const b = planLiveDeliveryActuals(input({ pickups: [{ id: "PU", actual_departure: "20261001090000-0400" }] }));
  assert.equal(b.pickup.arrivalDate, "20261001080000-0400");
  assert.equal(b.pickup.departureDate, "20261001090000-0400");
  assert.equal(b.pickup.generatedDeparture, false);
});

test("inferred times cannot overwrite an existing time or reverse stop chronology", () => {
  for (const pickups of [[{ id: "PU", actual_arrival: "20261001100000-0400" }],
    [{ id: "PU", actual_departure: "20261001060000-0400" }],
    [{ id: "PU", actual_arrival: "20261002103000-0400", actual_departure: "20261002110000-0400" }]]) {
    assert.throws(() => planLiveDeliveryActuals(input({ pickups })), /out of order/);
  }
  assert.throws(() => planLiveDeliveryActuals(input({ delivery: { id: "SO", actual_arrival: "20261002070000-0400", actual_departure: "20261002060000-0400" } })), /out of order/);
});

test("invalid dates and ambiguous missing pickup stops require review before writes", () => {
  for (const receivedDate of ["", "2026-02-30", "garbage"]) {
    assert.throws(() => planLiveDeliveryActuals(input({ receivedDate })), /Invalid received date/);
  }
  assert.throws(() => planLiveDeliveryActuals(input({ verifiedAt: new Date("2026-10-01T00:00:00Z") })), /Invalid check-in/);
  assert.throws(() => planLiveDeliveryActuals(input({ pickups: [] })), /Missing pickup/);
  assert.throws(() => planLiveDeliveryActuals(input({ pickups: [{ id: "PU1" }, { id: "PU2" }] })), /Multiple pickup/);
});
