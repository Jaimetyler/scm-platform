import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { bookingChargeCustomer } from "../lib/dray/booking-customers.ts";
import { rateReturnLocation } from "../lib/dray/service-rates.ts";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync("lib/dray/booking-customer-rate.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", code)(name => ({
  "./booking-customers": { bookingChargeCustomer },
  "./service-rates": { rateReturnLocation },
})[name] ?? require(name), exports);

function database(rows) {
  const filters = {};
  const query = {
    select() { return this; },
    eq(name, value) { filters[name] = value; return this; },
    in(name, values) { filters[name] = values; return this; },
    then(resolve) {
      return Promise.resolve({
        data: rows.filter(row => Object.entries(filters).every(([name, value]) =>
          Array.isArray(value) ? value.includes(row[name]) : row[name] === value)),
      }).then(resolve);
    },
  };
  return { from: () => query, filters };
}
const common = { active: true, service_type: "drayage" };
const houston = { terminal: "HOU", site_code: "5300", customer: "ED&F Man Cotton", return_location: "HOUSTON BAYPORT" };
const rows = [
  { ...common, terminal: "DAL", site_code: "", customer_code: "EDFMECTX", revenue_code: "DDRAY", return_location: "", rate_code: 1 },
  { ...common, terminal: "HOU", site_code: "5300", customer_code: "EDFMLOTX", revenue_code: "HLOCA", return_location: "HOURAIL", rate_code: 2 },
  { ...common, terminal: "HOU", site_code: "5300", customer_code: "EDFMLOTX", revenue_code: "HLOCA", return_location: "HOUPORT", rate_code: 3 },
];

test("Houston uses its local account and HLOCA port rate without selecting a rail or Dallas rate", async () => {
  for (const location of ["HOUSTON BAYPORT", "HOUSTON BARBOURS CUT"]) {
    const db = database(rows);
    const found = await exports.readBookingCustomerRate(db, { ...houston, return_location: location });
    assert.ok(found, JSON.stringify({filters:db.filters,rows, account:bookingChargeCustomer(houston.customer,"HOU")}));
    assert.equal(found.rate_code, 3);
    assert.equal(db.filters.customer_code, "EDFMLOTX");
    assert.equal(db.filters.revenue_code, "HLOCA");
  }
  assert.equal(await exports.readBookingCustomerRate(database(rows), { ...houston, return_location: null }), null);
  assert.equal(await exports.readBookingCustomerRate(database(rows), { ...houston, site_code: "4331" }), null);
});

test("Dallas account, revenue and terminal fallback remain available", async () => {
  const found = await exports.readBookingCustomerRate(database(rows), {
    ...houston, terminal: "DAL", site_code: "SCMDDETX", return_location: "BNSF HASLET",
  });
  assert.equal(found.rate_code, 1);
  assert.equal(bookingChargeCustomer("ED&F Man Cotton").code, "EDFMECTX");
  assert.equal(await exports.readBookingCustomerRate(database(rows), { ...houston, terminal: "SAV" }), null);
});

test("Houston unassign keeps the mark, equipment and notes and uses no Dallas order operations", async () => {
  const bookingId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const containerId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const markId = "cccccccc-cccc-4ccc-accc-cccccccccccc";
  const stamp = "2026-11-17T18:00:00Z";
  const row = { id: containerId, sequence_no: 1, booking_line_id: markId, updated_at: stamp,
    split_transfer_id: null, carrier_plan: { rate: { id: "old" } },
    container_number: "TEST1234567", seal_number: "SEAL123", chassis_number: "CHASSIS123", notes: "Warehouse notes" };
  const writes = [];
  const deps = {
    "@/lib/auth/guard": { withStaffAccess: fn => fn, staffActor: () => "operator" },
    "@supabase/supabase-js": { createClient: () => ({ from: table => ({
      select() { return this; }, eq() { return this; }, is() { return this; },
      update(values) { writes.push({ table, values }); Object.assign(row, values); return this; },
      async maybeSingle() {
        if (table === "cotton_outbound_bookings") return { data: { status: "draft" } };
        if (table === "cotton_outbound_booking_lines") return { data: { id: markId, line_status: "active" } };
        assert.equal(table, "cotton_outbound_containers");
        return { data: structuredClone(row) };
      },
    }) }) },
    "@/lib/warehouse/outbound/carrier-rates": {},
    "@/lib/inbound/checkin/sites": { CHECKIN_SITES: [{ terminal: "HOU", siteCode: "5300", materials: ["cotton"] }] },
    "@/lib/dray/dallas-billing-receipt": {},
    "@/lib/dray/dallas-billing-restore": {},
    "@/lib/dray/dallas-linked-order": {},
  };
  const route = ts.transpileModule(readFileSync("app/api/warehouse/outbound/bookings/[id]/containers/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", route)(name => deps[name] ?? require(name), module, module.exports);
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  try {
    const response = await module.exports.PATCH(new Request("https://example.invalid", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminal: "HOU", siteCode: "5300", containerId, expectedUpdatedAt: stamp,
        bookingLineId: markId, carrierPlan: null, containerNumber: row.container_number,
        sealNumber: row.seal_number, chassisNumber: row.chassis_number, notes: row.notes }),
    }), { params: Promise.resolve({ id: bookingId }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.container.carrier_plan, null);
    assert.equal(result.container.booking_line_id, markId);
    assert.equal(result.container.container_number, "TEST1234567");
    assert.equal(result.container.seal_number, "SEAL123");
    assert.equal(result.container.chassis_number, "CHASSIS123");
    assert.equal(result.container.notes, "Warehouse notes");
    assert.equal(writes.length, 1);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
