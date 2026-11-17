import test from "node:test";
import assert from "node:assert/strict";
import { houstonBookingInvoice, houstonDrayChargeCodes } from "../lib/dray/houston-booking-import.ts";
import { buildPayload, expectedCharges, billingNormalizationPayload } from "../lib/dray/mcleod.ts";
import { processInvoice, repairCreatedInvoice } from "../lib/dray/engine.ts";

const booking = { id: "BOOKING", terminal: "HOU", site_code: "5300", status: "draft",
  booking_number: "EBKG1234567", customer: "Bunge USA Agriculture LLC", scm_file_number: "FILE123", steamship_line: "MSC" };
const mark = { id: "MARK", mark: "MARK123", shipping_order: "2602285", requested_bales: 90, line_status: "active", load_source: "warehouse" };
const slot = { id: "SLOT", sequence_no: 1, booking_line_id: mark.id, split_transfer_id: null,
  container_number: "TEST1234567", seal_number: "SEAL", chassis_number: "CHASSIS",
  carrier_plan: { rate: { carrier_id: "CARRIER", rates: { base: { pay: 20000 }, chassisDays: { pay: 1000 }, chassisSplits: { pay: 3000 }, stopoffs: { pay: 2500 } } },
    quantities: { chassisDays: 3, chassisSplits: 1, stopoffs: 0 } } };
const billing = { base: 45000, minimumChassisDays: 3, chassisDays: 4500, chassisSplits: 7500, stopoffs: 5000 };
const source = () => houstonBookingInvoice(booking, slot, mark, billing, "2026-11-20");

test("Houston keeps Savannah dray references and FLAT conventions with HLOCA and the requested lane", () => {
  const { invoice, profile } = source();
  const payload = buildPayload(invoice, profile);
  assert.equal(payload.blnum, mark.mark);
  assert.equal(payload.consignee_refno, slot.container_number);
  assert.equal(payload.ordered_by, mark.shipping_order);
  assert.equal(payload.planning_comment, "FILE123");
  assert.equal(payload.booking_no_sucm, booking.booking_number);
  assert.equal(payload.order_type_id, "FLAT");
  assert.equal(payload.revenue_code_id, "HLOCA");
  assert.deepEqual(payload.stops.map(stop => stop.location_id), ["SUPPBAT1", "HOUPORT"]);
  assert.match(payload.stops[0].sched_arrive_early, /^20261120/);
  assert.equal(payload.rate, 450);
  assert.equal(payload.total_charge, 660);
  assert.equal(payload.movements[0].override_payee_id, "CARRIER");
  assert.equal(payload.movements[0].override_pay_amt, 260);
  assert.equal(invoice.bookingContainerId, slot.id);
  assert.equal(invoice.bookingId, booking.id);
  assert.equal(invoice.bales, 90);
});

test("unresolved rows, source loads and other warehouses cannot generate a payload", () => {
  for (const [b, c, m, rates] of [
    [{ ...booking, site_code: "4331" }, slot, mark, billing],
    [booking, { ...slot, carrier_plan: null }, mark, billing],
    [booking, { ...slot, container_number: null }, mark, billing],
    [booking, slot, { ...mark, line_status: "on_hold" }, billing],
    [booking, slot, { ...mark, load_source: "source_load" }, billing],
    [booking, slot, { ...mark, shipping_order: null }, billing],
    [{ ...booking, scm_file_number: null }, slot, mark, billing],
    [booking, slot, mark, { ...billing, base: null }],
  ]) assert.throws(() => houstonBookingInvoice(b, c, m, rates, "2026-11-20"));
});

test("the reused engine creates and rates once, saves the order receipt, and keeps orders available", async () => {
  const { invoice, profile } = source();
  let row = { id: "LEDGER", status: "ready", order_id: null, invoice, profile };
  let order;
  const calls = [];
  const store = {
    async claim(id, from, to) {
      if (row.status !== from) return null;
      row = { ...row, status: to };
      return row;
    },
    async finish(saved, status, order_id, note) { row = { ...saved, status, order_id, note }; },
  };
  const vendor = {
    async read(path) { return path.startsWith("/orders/search?") ? [] : structuredClone(order); },
    async write(path, payload) {
      calls.push(path);
      if (path === "/orders/create") {
        order = { ...payload, id: "0839999", otherCharges: expectedCharges(invoice, profile),
          movements: payload.movements.map(movement => ({ ...movement, id: "MOVE" })) };
        return { id: order.id };
      }
      throw Error("Unexpected write " + path);
    },
  };
  await processInvoice(row, store, vendor);
  assert.equal(row.status, "verified", row.note);
  assert.equal(row.order_id, "0839999");
  await processInvoice(row, store, vendor);
  assert.deepEqual(calls, ["/orders/create"]);
  assert.equal(order.status, "A");
  assert.ok(order.stops.every(stop => !stop.actual_arrival && !stop.actual_departure));
});

test("ED&F Houston may create and verify with blank Ordered By while retaining a supplied SO", async () => {
  const edf = { ...booking, customer: "ED&F Man Cotton", booking_number: "96150957" };
  const { invoice, profile } = houstonBookingInvoice(edf, slot, { ...mark, shipping_order: null }, billing, "2026-11-20");
  const payload = buildPayload(invoice, profile);
  assert.equal(payload.customer_id, "EDFMLOTX");
  assert.equal(payload.ordered_by, "");
  assert.equal(payload.blnum, mark.mark);
  assert.equal(payload.booking_no_sucm, "96150957");
  assert.equal(payload.planning_comment, booking.scm_file_number);
  let row = { id: "EDF", status: "ready", order_id: null, invoice, profile };
  let order;
  const store = {
    async claim(id, from, to) {
      if (row.status !== from) return null;
      row = { ...row, status: to };
      return row;
    },
    async finish(saved, status, order_id, note) { row = { ...saved, status, order_id, note }; },
  };
  await processInvoice(row, store, {
    async read(path) { return path.startsWith("/orders/search?") ? [] : structuredClone(order); },
    async write(path, body) {
      assert.equal(path, "/orders/create");
      order = { ...body, id: "EDFORDER", otherCharges: expectedCharges(invoice, profile),
        movements: body.movements.map(movement => ({ ...movement, id: "EDFMOVE" })) };
      delete order.ordered_by;
      return { id: order.id };
    },
  });
  assert.equal(row.status, "verified", row.note);
  const supplied = houstonBookingInvoice(edf, slot, mark, billing, "2026-11-20");
  assert.equal(buildPayload(supplied.invoice, supplied.profile).ordered_by, mark.shipping_order);
  assert.throws(() => buildPayload({ ...invoice, customerId: "BUNGOMNE" }, profile), /Shipper's Order/);
});


test("new Houston orders may omit an empty charge list only with a verified zero extras total", async () => {
  const { invoice, profile } = houstonBookingInvoice(
    { ...booking, customer: "ED&F Man Cotton" }, slot, { ...mark, shipping_order: null }, billing, "2026-11-20");
  const before = { ...buildPayload(invoice, profile), id: "EXISTING", otherchargetotal: 0,
    total_charge: invoice.baseCents / 100,
    movements: [{ id: "MOVE", override_payee_id: "", status: "A" }] };
  const normalization = billingNormalizationPayload(before, invoice, profile, "EXISTING");
  assert.ok(normalization.otherCharges.length > 0);
  assert.equal(normalization.total_charge, invoice.cents / 100);
  assert.throws(() => billingNormalizationPayload({ ...before, otherchargetotal: undefined }, invoice, profile, "EXISTING"), /Charges unavailable/);
  assert.throws(() => billingNormalizationPayload({ ...before, otherchargetotal: 5 }, invoice, profile, "EXISTING"), /Charges unavailable/);
  assert.throws(() => billingNormalizationPayload({ ...before, total_charge: 999 }, invoice, profile, "EXISTING"), /Charges unavailable/);

  let row = { id: "LEDGER", status: "blocked", order_id: "EXISTING", invoice, profile };
  let order = structuredClone(before);
  const writes = [];
  await repairCreatedInvoice(row, {
    async claim(id, from, to) { row = { ...row, status: to }; return row; },
    async finish(saved, status, order_id, note) { row = { ...saved, status, order_id, note }; },
  }, {
    async read() { return structuredClone(order); },
    async write(path, body) {
      writes.push(path);
      if (path === "/other_charge/create") {
        order.otherCharges = [...(order.otherCharges ?? []), { ...body, id: "CHARGE" }];
        order.otherchargetotal = body.amount;
      }
      else if (path === "/orders/updateRow") Object.assign(order, body);
      else if (path === "/movement/update") Object.assign(order.movements[0], body);
      else if (!path.startsWith("/carrierDispatch/setPay/")) throw Error("Unexpected write " + path);
    },
  });
  assert.equal(row.status, "verified", row.note);
  assert.equal(row.order_id, "EXISTING");
  assert.equal(order.total_charge, invoice.cents / 100);
  assert.ok(!writes.includes("/orders/create"));
});


test("Houston has its own customer charge codes including standard fuel", () => {
  assert.deepEqual(houstonDrayChargeCodes, { chassisDays: "019", chassisSplits: "HSPT", stopoffs: "006", fuel: "HFS" });
  const { invoice } = source();
  assert.equal(invoice.charges.find(charge => charge.description === "HOU Chassis Charges").code, "019");
  assert.equal(invoice.charges.find(charge => charge.description === "Chassis splits").code, "HSPT");
});
