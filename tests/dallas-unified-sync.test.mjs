import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import * as booking from "../lib/dray/dallas-import-orders.ts";
import * as carrier from "../lib/warehouse/outbound/carrier-rates.ts";
import * as fuel from "../lib/dray/dallas-fuel.ts";
import * as billing from "../lib/dray/dallas-customer-extras.ts";
import { mcleodOrderStops } from "../lib/inbound/checkin/yard-stop.ts";

const require = createRequire(import.meta.url);
const bookingId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const orderId = "0830845";
function fixture(withCarrier, packageDates = false) {
  const stops = [
    { id: "STOP1", stop_type: "PU", location_id: "SCMDDETX", status: "A" },
    { id: "STOP2", stop_type: "SO", location_id: "BNSFHATX", status: "A" },
  ];
  const order = {
    id: orderId, status: "A", order_type_id: "FSCD", booking_no_sucm: "BOOK-1", blnum: "FILE-1",
    consignee_refno: "", planning_comment: "Keep this note", rate_type: "F", rate: 500, rate_units: 1,
    stops, total_charge: 500, otherCharges: [], movements: [{ id: "MOVE1", status: "A" }],
  };
  const tables = {
    cotton_outbound_bookings: { booking_number: packageDates ? "BOOK-2" : "BOOK-1", site_code: "SCMDDETX", return_location_code: "BNSFHATX", scm_file_number: "FILE", status: "draft",
      erd: packageDates ? "2026-11-16" : null, cutoff: packageDates ? "2026-11-18T10:30" : null, terminal: "DAL" },
    dallas_dray_import_loads: { blnum: "FILE-1", sequence_no: 1, payload: { stops: structuredClone(stops) } },
    cotton_outbound_containers: { container_number: "ABCD1234567", booking_line_id: "line", updated_at: "2026-11-16T10:00Z",
      carrier_plan: withCarrier ? { rate: { carrier_id: "CARRIER", rates: { base: { pay: 10000 }, chassisDays: { pay: 0 }, chassisSplits: { pay: 0 }, stopoffs: { pay: 0 } } },
        quantities: { chassisDays: 0, stopoffs: 0, chassisSplits: 0 } } : null },
    cotton_outbound_booking_lines: { mark: "MARK1", line_status: "active" },
  };
  const writes = [];
  const vendor = readOnly => ({
    read: async () => [],
    write: async (path, body) => {
      assert.equal(readOnly, false);
      writes.push({ path, body });
      if (path === "/orders/updateRow") Object.assign(order, body);
      if (path === "/stop/update") Object.assign(stops.find(stop => stop.id === body.id), body);
      if (path === "/movement/update") Object.assign(order.movements[0], body);
    },
  });
  const deps = {
    "@/lib/auth/session": { staffDatabase: () => ({ from: table => ({
      select() { return this; }, eq() { return this; }, is() { return this; },
      async maybeSingle() { return { data: tables[table], error: null }; },
    }) }) },
    "@/lib/auth/guard": { withStaffAccess: fn => fn },
    "@/lib/dray/server": { hash: value => createHash("sha256").update(JSON.stringify(value)).digest("hex"), vendor },
    "@/lib/dray/dallas-linked-order": { readLinkedDallasOrder: async () => structuredClone(order), currentDallasMovement: value => value.movements[0] },
    "@/lib/dray/dallas-billing-receipt": { lockDallasBilling: async () => ({ async recordBookingNumber(value) { assert.equal(value, "BOOK-2"); }, async release() {} }) },
    "@/lib/dray/dallas-import-orders": booking,
    "@/lib/inbound/checkin/yard-stop": { mcleodOrderStops },
    "@/lib/warehouse/outbound/carrier-rates": carrier,
    "@/lib/dray/dallas-fuel": fuel,
    "@/lib/dray/dallas-customer-extras": billing,
    "@/lib/dray/dallas-extra-pay": { dallasExtraPayLines: () => [], readDallasExtraPay: async () => [] },
    "@/lib/dray/booking-customer-rate": { readBookingCustomerRate: async () => null },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync("app/api/dray-import/dallas/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)(
    name => name.startsWith("@/") ? deps[name] ?? {} : require(name), module, module.exports);
  const request = (action, token) => module.exports.POST(new Request("https://example.test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, bookingId, orderId, token }),
  }));
  return { writes, request, order };
}

for (const withCarrier of [false, true]) {
  test(`one preview and apply sends saved mark and container ${withCarrier ? "with carrier pay" : "before carrier assignment"}`, async () => {
    const writesEnabled = process.env.DRAY_IMPORT_WRITES_ENABLED;
    const syncEnabled = process.env.MCLEOD_SYNC_ENABLED;
    process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
    process.env.MCLEOD_SYNC_ENABLED = "true";
    try {
      const { request, writes, order } = fixture(withCarrier);
      const preview = await (await request("preview-load")).json();
      assert.equal(preview.canSendDetails, true);
      assert.equal(preview.canSendPay, withCarrier);
      assert.equal(writes.length, 0);
      const applied = await (await request("apply-load", preview.token)).json();
      assert.deepEqual(applied.issues, []);
      assert.deepEqual(applied.applied, withCarrier ? ["Booking details", "Carrier payee and base pay"] : ["Booking details"]);
      assert.equal(writes[0].body.blnum, "MARK1");
      assert.equal(writes[0].body.consignee_refno, "ABCD1234567");
      assert.deepEqual(Object.keys(writes[0].body).sort(), ["__type", "blnum", "company_id", "consignee_refno", "id"].sort());
      assert.equal(order.planning_comment, "Keep this note");
    } finally {
      if (writesEnabled === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
      else process.env.DRAY_IMPORT_WRITES_ENABLED = writesEnabled;
      if (syncEnabled === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
      else process.env.MCLEOD_SYNC_ENABLED = syncEnabled;
    }
  });
}


test("an explicit package replacement sends McLeod-format dates and skips load and pay fields", async () => {
  const original = { write: process.env.DRAY_IMPORT_WRITES_ENABLED, sync: process.env.MCLEOD_SYNC_ENABLED };
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes } = fixture(true, true);
    const preview = await (await request("preview-package")).json();
    assert.deepEqual(preview.issues, [], JSON.stringify(preview));
    assert.deepEqual(preview.changes.map(change => change.field).sort(), [
      "Delivery scheduled end", "Delivery scheduled start", "Pickup scheduled end", "Pickup scheduled start",
      "booking_no_sucm", "cutoff_date", "planning_comment",
    ]);
    assert.equal(writes.length, 0);
    const applied = await (await request("apply-package", preview.token)).json();
    assert.deepEqual(applied.issues, []);
    assert.deepEqual(applied.applied, ["Booking details", "Pickup schedule", "Delivery schedule"]);
    assert.equal(writes.length, 3);
    assert.equal(writes[0].body.booking_no_sucm, "BOOK-2");
    for (const { path, body } of writes.slice(1)) {
      assert.equal(path, "/stop/update");
      assert.equal(body.sched_arrive_early, "20261116000000-0600");
      assert.equal(body.sched_arrive_late, "20261118103000-0600");
    }
    assert.equal(writes[0].body.cutoff_date, "20261118103000-0600");
    assert.equal(writes[0].body.blnum, undefined);
    assert.equal(writes[0].body.consignee_refno, undefined);
    assert.equal(booking.dallasMcLeodDetailDate("2026-07-18T10:30"), "20260718103000-0500");
  } finally {
    if (original.write === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = original.write;
    if (original.sync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = original.sync;
  }
});
