import test from "node:test";
import assert from "node:assert/strict";
import { createDallasPilotPayload, reviewDallasPilotOrder, scmIntermodalPay } from "../lib/warehouse/outbound/dallas-order-pilot.ts";

const plan = { booking: "2342891820", container: "CSNU7669889", bol: "X4810 3586190",
  orderedBy: "11921", early: "2026-11-10", late: "2026-11-11" };
const order = {
  ...createDallasPilotPayload(plan), id: "0830504", curr_movement_id: "652271",
  booking_no_sucm: "", planning_comment: "ID47378 OOCL BKG: 2342891820 - ERD 11/08 - C/O 11/13 BOLT SEALS",
  movements: [{ ...createDallasPilotPayload(plan).movements[0], id: "652271", status: "A" }],
  otherCharges: [{ charge_id: "DSCM", units: 1, rate: 35, amount: 35, incl_in_freight: "N" }],
};

test("creates the verified DeSoto–Haslet lane with flat carrier pay", () => {
  const payload = createDallasPilotPayload(plan);
  assert.equal(payload.order_type_id, "FSCD");
  assert.deepEqual(payload.stops.map(stop => stop.location_id), ["SCMDDETX", "BNSFHATX"]);
  assert.equal(payload.stops[0].sched_arrive_early, "20261110000000-0600");
  assert.equal(payload.movements[0].override_payee_id, "SCMIRIGA");
  assert.equal(payload.movements[0].override_pay_amt, 392.93);
  assert.equal(scmIntermodalPay.UNIOWITX, 20085);
  assert.equal(payload.rate, 545);
  assert.equal(payload.otherCharges, undefined);
  assert.throws(() => createDallasPilotPayload({ ...plan, early: "2026-11-31" }), /valid schedule/);
});

test("recognizes the pilot order through the planning comment without duplicating chassis", () => {
  const review = reviewDallasPilotOrder(order, plan);
  assert.equal(review.billing, null);
  assert.equal(review.movement, null);
  const missingChassis = reviewDallasPilotOrder({ ...order, otherCharges: [], total_charge: 545 }, plan);
  assert.equal(missingChassis.billing.otherCharges[0].charge_id, "DSCM");
  assert.equal(missingChassis.billing.total_charge, 580);
  assert.equal(missingChassis.movement, null);
});

test("prepares a changed flat rate only for the verified payee and blocks unsafe matches", () => {
  const underpaid = { ...order, movements: [{ ...order.movements[0], override_pay_amt: 300 }] };
  const review = reviewDallasPilotOrder(underpaid, plan);
  assert.equal(review.before.pay, 300);
  assert.equal(review.movement.override_pay_amt, 392.93);
  assert.throws(() => reviewDallasPilotOrder({ ...order, movements: [{ ...order.movements[0], carrier_id: "OTHER" }] }, plan), /payee/);
  assert.throws(() => reviewDallasPilotOrder({ ...order, otherCharges: [...order.otherCharges, { charge_id: "CS" }] }, plan), /charges/);
  assert.throws(() => reviewDallasPilotOrder({ ...order, status: "D" }, plan), /status/);
  assert.throws(() => reviewDallasPilotOrder(order, { ...plan, booking: "1234" }), /identity/);
});
