import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import { houstonBookingInvoice } from "../lib/dray/houston-booking-import.ts";
import { buildPayload } from "../lib/dray/mcleod.ts";

const require = createRequire(import.meta.url);
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const slotId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
function fixture() {
  const booking = { id, terminal: "HOU", site_code: "5300", status: "draft", customer: "Bunge USA Agriculture LLC",
    booking_number: "BOOK123", scm_file_number: "FILE", steamship_line: "MSC", updated_at: "2026-11-17T12:00:00Z" };
  const mark = { id: "MARK", mark: "MARK123", shipping_order: "SO123", requested_bales: 90, line_status: "active", load_source: "warehouse" };
  const slot = { id: slotId, sequence_no: 1, booking_line_id: mark.id, split_transfer_id: null,
    container_number: "TEST1234567", seal_number: "", chassis_number: "", carrier_plan: {
      rate: { carrier_id: "CARRIER", rates: { base: { pay: 20000 }, chassisDays: { pay: 0 }, chassisSplits: { pay: 0 }, stopoffs: { pay: 0 } } },
      quantities: { chassisDays: 0, chassisSplits: 0, stopoffs: 0 },
    } };
  const records = [];
  let creates = 0;
  let stages = 0;
  let syncs = 0;
  const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const db = {
    from(table) {
      const data = table === "cotton_outbound_bookings" ? [booking] : table === "cotton_outbound_containers" ? [slot] :
        table === "cotton_outbound_booking_lines" ? [mark] : records;
      const q = {
        select() { return this; },
        update(values) { Object.assign(data[0], values); return this; },
        async insert() { return { error: null }; },
        eq() { return this; }, is() { return this; }, order() { return this; },
        async maybeSingle() { return { data: structuredClone(data[0]) }; },
        async single() { return { data: { status: data[0].status, order_id: data[0].order_id, note: data[0].note } }; },
        then(resolve) { return Promise.resolve({ data: structuredClone(data) }).then(resolve); },
      };
      return q;
    },
    async rpc(name, input) {
      assert.equal(name, "prepare_dray_import");
      stages++;
      if (!records.length) records.push({ id: "LEDGER", version: 0, status: "ready", order_id: null, invoice: input.p_rows[0].invoice,
        profile: input.p_profile, source_hash: input.p_rows[0].source_hash, note: "" });
      return { data: "RUN" };
    },
  };
  const deps = {
    "@/lib/auth/guard": { withStaffAccess: fn => fn, staffActor: () => "HOU operator" },
    "@/lib/auth/session": { staffDatabase: () => db },
    "@/lib/dray/server": { hash, databaseStore: () => ({
        async finish(saved, status, order_id, note) { Object.assign(records[0], { status, order_id, note }); },
      }), vendor: () => ({ read: async () => ({}) }),
      readRun: async () => ({ items: [{ order: records[0], conflict: false }] }) },
    "@/lib/dray/engine": { processInvoice: async row => {
      if (row.status === "verified") return;
      creates++; Object.assign(row, { status: "verified", order_id: "0839999", note: "Verified" });
    } },
    "@/lib/dray/houston-booking-sync": { planHoustonBookingSync: () => ({}), syncHoustonBookingCharges: async () => { syncs++; } },
    "@/lib/dray/mcleod": { buildPayload },
    "@/lib/dray/houston-booking-import": { houstonBookingInvoice },
    "@/lib/dray/booking-customer-rate": { readBookingCustomerRate: async (db, scope) => {
      assert.equal(scope.return_location_code, "HOUPORT");
      return { fuel_mode: "all_in", base_rate: 450, included_chassis_days: 3, chassis_daily_rate: 45, chassis_split_rate: 75, stopoff_rate: 50 };
    } },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync("app/api/warehouse/outbound/bookings/[id]/houston-import/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)(name => deps[name] ?? require(name), module, module.exports);
  return { slot, get syncs() { return syncs; }, get creates() { return creates; }, get stages() { return stages; },
    async request(body) {
      const response = await module.exports.POST(new Request("https://test.invalid", {
        method: "POST", body: JSON.stringify({ date: "2026-11-20", ...body }),
      }), { params: Promise.resolve({ id }) });
      return { status: response.status, data: await response.json() };
    } };
}

test("preview stages nothing and stale booking edits stop before staging or creation", async () => {
  const f = fixture();
  const result = await f.request({ action: "preview" });
  assert.equal(result.status, 200);
  assert.equal(result.data.rows[0].ready, true);
  assert.equal(f.stages, 0);
  assert.equal(f.creates, 0);
  f.slot.container_number = "DIFF1234567";
  const priorWrite = process.env.DRAY_IMPORT_WRITES_ENABLED;
  const priorSync = process.env.MCLEOD_SYNC_ENABLED;
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  let stopped;
  try { stopped = await f.request({ action: "create", containerId: slotId, token: result.data.rows[0].token }); }
  finally {
    if (priorWrite === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = priorWrite;
    if (priorSync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = priorSync;
  }
  assert.match(stopped.data.error, /changed/);
  assert.equal(stopped.status, 400);
  assert.equal(f.stages, 0);
  assert.equal(f.creates, 0);
});

test("creation saves the order link and replay uses the existing ledger receipt", async () => {
  const previousWrite = process.env.DRAY_IMPORT_WRITES_ENABLED;
  const previousSync = process.env.MCLEOD_SYNC_ENABLED;
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const f = fixture();
    const preview = await f.request({ action: "preview" });
    const body = { action: "create", containerId: slotId, token: preview.data.rows[0].token };
    const created = await f.request(body);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.orderId, "0839999");
    const repeated = await f.request(body);
    assert.equal(repeated.status, 200);
    assert.equal(f.creates, 1);
    const after = await f.request({ action: "preview" });
    assert.equal(after.data.rows[0].ready, false);
    assert.equal(after.data.rows[0].orderId, "0839999");
    f.slot.carrier_plan.quantities.chassisSplits = 1;
    const changed = await f.request({ action: "preview" });
    assert.equal(changed.data.rows[0].canSync, true);
    assert.equal(changed.data.rows[0].ready, false);
    const synced = await f.request({ action: "sync", containerId: slotId, token: changed.data.rows[0].token });
    assert.equal(synced.status, 200, JSON.stringify(synced.data));
    assert.equal(f.syncs, 1);
    assert.equal(f.creates, 1);
  } finally {
    if (previousWrite === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = previousWrite;
    if (previousSync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = previousSync;
  }
});
