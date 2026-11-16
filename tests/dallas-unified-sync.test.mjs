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

const require = createRequire(import.meta.url);
const bookingId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const orderId = "0830845";
function fixture(withCarrier) {
  const order = {
    id: orderId, status: "A", order_type_id: "FSCD", booking_no_sucm: "BOOK-1", blnum: "FILE-1",
    consignee_refno: "", planning_comment: "Keep this note", rate_type: "F", rate: 500, rate_units: 1,
    total_charge: 500, otherCharges: [], movements: [{ id: "MOVE1", status: "A" }],
  };
  const tables = {
    cotton_outbound_bookings: { booking_number: "BOOK-1", scm_file_number: "FILE", status: "draft",
      erd: null, cutoff: null, terminal: "DAL" },
    dallas_dray_import_loads: { blnum: "FILE-1", sequence_no: 1, payload: {} },
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
    "@/lib/dray/dallas-billing-receipt": { lockDallasBilling: async () => ({ async release() {} }) },
    "@/lib/dray/dallas-import-orders": booking,
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
