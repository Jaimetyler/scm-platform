import test from "node:test";
import assert from "node:assert/strict";
import { houstonBookingInvoice } from "../lib/dray/houston-booking-import.ts";
import { buildPayload, expectedCharges } from "../lib/dray/mcleod.ts";
import { planHoustonBookingSync, syncHoustonBookingCharges } from "../lib/dray/houston-booking-sync.ts";

const booking = { id: "BOOKING", terminal: "HOU", site_code: "5300", status: "draft", customer: "ED&F Man Cotton",
  scm_file_number: "3142", steamship_line: "HAP", booking_number: "96150957" };
const mark = { id: "MARK", mark: "W4311", shipping_order: null, line_status: "active", load_source: "warehouse", requested_bales: 90 };
const rate = { carrier_id: "SCMIRIGA", rates: { base: { pay: 24500 }, chassisDays: { pay: 1000 },
  chassisSplits: { pay: 3000 }, stopoffs: { pay: 2500 } } };
const billing = { base: 45000, minimumChassisDays: 3, chassisDays: 4500, chassisSplits: 7500, stopoffs: 5000 };
function source(quantities = {}) {
  return houstonBookingInvoice(booking, { id: "SLOT", sequence_no: 1, booking_line_id: mark.id, split_transfer_id: null,
    container_number: "FANU3247881", seal_number: "", chassis_number: "", carrier_plan: {
      rate, quantities: { chassisDays: 0, chassisSplits: 0, stopoffs: 0, ...quantities },
    } }, mark, billing, "2026-11-16");
}
function fixture(previous) {
  let order = { ...buildPayload(previous.invoice, previous.profile), id: "0831479", curr_movement_id: "MOVE",
    otherCharges: expectedCharges(previous.invoice, previous.profile).map((charge, index) => ({ ...charge, id: "CHARGE" + index })),
    movements: buildPayload(previous.invoice, previous.profile).movements.map(movement => ({ ...movement, id: "MOVE", status: "A" })) };
  const writes = [];
  let rejectTotal = false;
  let rejectCreate = false;
  const vendor = {
    async read() { return structuredClone(order); },
    async deleteCustomerCharge(id) { writes.push({ path: "/delete", id }); order.otherCharges = order.otherCharges.filter(row => row.id !== id); },
    async write(path, body) {
      writes.push({ path, body });
      if (path === "/other_charge/create") {
        if (rejectCreate) { rejectCreate = false; throw Error("Temporary charge-create failure"); }
        (order.otherCharges ??= []).push({ ...body, id: "NEW" + writes.length });
      }
      else if (path === "/other_charge/update") Object.assign(order.otherCharges.find(row => row.id === body.id), body);
      else if (path === "/orders/updateRow") {
        if (rejectTotal) { rejectTotal = false; throw Error("Temporary bill-total failure"); }
        Object.assign(order, body);
      } else if (path === "/movement/update") Object.assign(order.movements[0], body);
      else if (!path.startsWith("/carrierDispatch/setPay/")) throw Error("Unexpected write");
    },
  };
  return { get order() { return order; }, writes, vendor, rejectNextTotal() { rejectTotal = true; }, rejectNextCreate() { rejectCreate = true; } };
}
test("carrier accessorial pay uses carrier prices and corresponding customer extras use customer prices", async () => {
  const previous = source();
  const desired = source({ chassisDays: 4, chassisSplits: 1, stopoffs: 1 });
  const f = fixture(previous);
  const plan = planHoustonBookingSync(f.order, previous, desired, f.order.id);
  assert.equal(plan.pay, 340);
  assert.equal(plan.bill, 755);
  await syncHoustonBookingCharges({ ...desired, id: "LEDGER", status: "rating", order_id: f.order.id }, previous, f.vendor);
  assert.deepEqual(f.order.otherCharges.map(row => [row.charge_id, row.amount]), [["019", 180], ["HSPT", 75], ["006", 50]]);
  assert.equal(f.order.movements[0].override_pay_rate, 340);
  assert.equal(f.order.total_charge, 755);
});
test("removing extras reduces carrier pay and customer bill while retaining the three-day chassis minimum", async () => {
  const previous = source({ chassisSplits: 1 });
  const desired = source();
  const f = fixture(previous);
  await syncHoustonBookingCharges({ ...desired, id: "LEDGER", status: "rating", order_id: f.order.id }, previous, f.vendor);
  assert.deepEqual(f.order.otherCharges.map(row => [row.charge_id, row.amount]), [["019", 135]]);
  assert.equal(f.order.total_charge, 585);
  assert.equal(f.order.movements[0].override_pay_rate, 245);
  assert.equal(f.writes.filter(row => row.path === "/delete").length, 1);
});
test("an interrupted sync can finish the saved total without duplicating the already-created customer charge", async () => {
  const previous = source();
  const desired = source({ chassisSplits: 1 });
  const f = fixture(previous);
  const row = { ...desired, id: "LEDGER", status: "rating", order_id: f.order.id };
  f.rejectNextTotal();
  await assert.rejects(syncHoustonBookingCharges(row, previous, f.vendor), /Temporary/);
  assert.equal(f.order.otherCharges.filter(row => row.charge_id === "HSPT").length, 1);
  await syncHoustonBookingCharges(row, previous, f.vendor, true);
  assert.equal(f.order.total_charge, 660);
  assert.equal(f.order.movements[0].override_pay_rate, 275);
  assert.equal(f.writes.filter(row => row.path === "/other_charge/create").length, 1);
});
test("changed or unrelated McLeod charges block sync before any write", async () => {
  const previous = source();
  const desired = source({ chassisSplits: 1 });
  const f = fixture(previous);
  f.order.otherCharges[0].amount = 999;
  await assert.rejects(syncHoustonBookingCharges({ ...desired, id: "LEDGER", status: "rating", order_id: f.order.id }, previous, f.vendor), /differs/);
  assert.equal(f.writes.length, 0);
  await assert.rejects(syncHoustonBookingCharges({ ...desired, id: "LEDGER", status: "rating", order_id: f.order.id }, previous, f.vendor, true), /differs/);
  assert.equal(f.writes.length, 0);
});


test("Houston migrates its saved chassis line to 019 without changing totals or carrier pay", async () => {
  const desired = source();
  const previous = { ...desired, invoice: { ...desired.invoice,
    charges: desired.invoice.charges.map(charge => ({ ...charge, code: "040" })) } };
  const f = fixture(previous);
  await syncHoustonBookingCharges({ ...desired, id: "LEDGER", status: "rating", order_id: f.order.id }, previous, f.vendor);
  assert.deepEqual(f.order.otherCharges.map(row => [row.charge_id, row.amount]), [["019", 135]]);
  assert.equal(f.order.total_charge, 585);
  assert.equal(f.order.movements[0].override_pay_rate, 245);
});


test("an interrupted code correction resumes from McLeod's omitted empty charge collection", async () => {
  const desired = source();
  const previous = { ...desired, invoice: { ...desired.invoice,
    charges: desired.invoice.charges.map(charge => ({ ...charge, code: "040" })) } };
  const f = fixture(previous);
  const row = { ...desired, id: "LEDGER", status: "rating", order_id: f.order.id };
  f.rejectNextCreate();
  await assert.rejects(syncHoustonBookingCharges(row, previous, f.vendor), /Temporary charge-create/);
  delete f.order.otherCharges;
  f.order.otherchargetotal = 0;
  await syncHoustonBookingCharges(row, previous, f.vendor, true);
  assert.deepEqual(f.order.otherCharges.map(row => row.charge_id), ["019"]);
  assert.equal(f.order.total_charge, 585);
});
