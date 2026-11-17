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
function fixture(withCarrier, packageDates = false, cutoffReadback, validateSchedule = false, timestamps = {}) {
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
    dallas_dray_import_loads: { blnum: "FILE-1", sequence_no: 1, payload: { stops: structuredClone(stops), blnum: "FILE-1", booking_no_sucm: "BOOK-1", planning_comment: "Keep this note" } },
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
      if (path === "/orders/updateRow") {
        Object.assign(order, body);
        if (body.cutoff_date && cutoffReadback !== undefined) order.cutoff_date = cutoffReadback;
      }
      if (path === "/stop/update") {
        const stop = stops.find(stop => stop.id === body.id);
        if (validateSchedule) {
          const pickupEnd = stop.stop_type === "PU" ? body.sched_arrive_late ?? stop.sched_arrive_late : stops[0].sched_arrive_late;
          const deliveryStart = stop.stop_type === "SO" ? body.sched_arrive_early ?? stop.sched_arrive_early : stops[1].sched_arrive_early;
          if (pickupEnd && deliveryStart && pickupEnd > deliveryStart)
            throw Error("McLeod HTTP 406: The scheduled arrival at the shipper cannot be later than the scheduled arrival at the consignee");
        }
        Object.assign(stop, body);
      }
      if (path === "/movement/update") Object.assign(order.movements[0], body);
    },
  });
  const deps = {
    "@/lib/auth/session": { staffDatabase: () => ({ rpc: async () => ({ data: timestamps }), from: table => ({
      select() { return this; }, eq() { return this; }, is() { return this; },
      update(values) { Object.assign(tables[table], values); return this; },
      async maybeSingle() { return { data: tables[table], error: null }; },
    }) }) },
    "@/lib/auth/guard": { withStaffAccess: fn => fn },
    "@/lib/dray/server": { hash: value => createHash("sha256").update(JSON.stringify(value)).digest("hex"), vendor },
    "@/lib/dray/dallas-linked-order": { readLinkedDallasOrder: async () => structuredClone(order), currentDallasMovement: value => value.movements[0] },
    "@/lib/dray/dallas-billing-receipt": { lockDallasBilling: async () => ({ async recordDetails() {}, async recordBookingNumber(value) { assert.equal(value, "BOOK-2"); }, async release() {} }) },
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
  return { writes, request, order, tables };
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


test("a booking-details sync sends McLeod-format dates and skips load and pay fields", async () => {
  const original = { write: process.env.DRAY_IMPORT_WRITES_ENABLED, sync: process.env.MCLEOD_SYNC_ENABLED };
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes } = fixture(true, true, "20261118163000+0000", true);
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
      assert.equal(body.sched_arrive_late, body.id === "STOP1" ? "20261116000000-0600" : "20261118103000-0600");
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

test("an unverified order cutoff reports the values and still verifies the stop schedules", async () => {
  const original = { write: process.env.DRAY_IMPORT_WRITES_ENABLED, sync: process.env.MCLEOD_SYNC_ENABLED };
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request } = fixture(true, true, "20261117103000-0600");
    const preview = await (await request("preview-package")).json();
    const applied = await (await request("apply-package", preview.token)).json();
    assert.deepEqual(applied.applied, ["Some booking details", "Pickup schedule", "Delivery schedule"]);
    assert.deepEqual(applied.issues, ["McLeod cutoff_date expected 2026-11-18T10:30:00, read back 20261117103000-0600."]);
  } finally {
    if (original.write === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = original.write;
    if (original.sync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = original.sync;
  }
});

test("order cutoff comparison honors the precision saved on the booking", () => {
  const compare = booking.matchesDallasMcLeodDetailDate;
  assert.equal(compare("20261118000000-0500", "2026-11-18T10:30:00", true), true);
  assert.equal(compare("20261118000000-0500", "2026-11-18T10:30:00"), false);
  assert.equal(compare("20261117", "2026-11-18T00:00:00", true), false);
  assert.equal(compare("2026-11-18T16:30:00Z", "2026-11-18T10:30:00"), true);
});

test("regular sync includes booking and stop changes and flags an independently changed McLeod field", async () => {
  const previousWrite = process.env.DRAY_IMPORT_WRITES_ENABLED;
  const previousSync = process.env.MCLEOD_SYNC_ENABLED;
  process.env.DRAY_IMPORT_WRITES_ENABLED = process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes, order } = fixture(true, true);
    order.consignee_refno = "EFGH1234567";
    const preview = await (await request("preview-load")).json();
    assert.equal(preview.canSendDetails, true);
    assert.deepEqual(preview.detailBlockers, [
      "consignee_refno: McLeod has EFGH1234567 and the platform has ABCD1234567. Review which value is current.",
    ]);
    assert.equal(preview.detailChanges.some(change => change.field === "Delivery scheduled end"), true);
    const applied = await (await request("apply-load", preview.token)).json();
    assert.deepEqual(applied.applied, ["Booking details", "Pickup schedule", "Delivery schedule", "Carrier payee and base pay"]);
    assert.deepEqual(applied.issues, preview.detailBlockers);
    assert.equal(writes[0].body.booking_no_sucm, "BOOK-2");
    assert.equal(order.consignee_refno, "EFGH1234567");
  } finally {
    if (previousWrite === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = previousWrite;
    if (previousSync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = previousSync;
  }
});

test("regular sync pulls a McLeod container when the platform still matches the last verified value", async () => {
  const previousWrite = process.env.DRAY_IMPORT_WRITES_ENABLED;
  const previousSync = process.env.MCLEOD_SYNC_ENABLED;
  process.env.DRAY_IMPORT_WRITES_ENABLED = process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes, order, tables } = fixture(false);
    order.blnum = "MARK1";
    order.consignee_refno = "EFGH1234567";
    tables.dallas_dray_import_loads.payload.outboundSyncedDetails = { consignee_refno: "ABCD1234567" };
    const preview = await (await request("preview-load")).json();
    assert.deepEqual(preview.detailChanges, [{ field: "Container (McLeod → Platform)", before: "ABCD1234567", after: "EFGH1234567" }]);
    assert.deepEqual(preview.detailBlockers, []);
    const applied = await (await request("apply-load", preview.token)).json();
    assert.deepEqual(applied.applied, ["Container pulled from McLeod"]);
    assert.equal(tables.cotton_outbound_containers.container_number, "EFGH1234567");
    assert.equal(writes.length, 0);
  } finally {
    if (previousWrite === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = previousWrite;
    if (previousSync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = previousSync;
  }
});

test("regular sync compares compact staged dates even when McLeod returns a different time", async () => {
  const { request, writes, order, tables } = fixture(false, true);
  order.cutoff_date = "20261118160000+0000";
  order.stops[0].sched_arrive_late = "20261118173000+0000";
  tables.dallas_dray_import_loads.payload.cutoff_date = "20261118100000-0600";
  tables.dallas_dray_import_loads.payload.stops[0].sched_arrive_late = "20261118103000-0600";
  const response = await request("preview-load");
  const preview = await response.json();
  assert.equal(response.ok, true, JSON.stringify(preview));
  assert.deepEqual(preview.detailBlockers, [
    "Pickup scheduled end: McLeod has 20261118173000+0000 and the platform has 2026-11-16T00:00:00. Review which value is current.",
  ]);
  assert.equal(preview.detailChanges.some(change => change.field === "cutoff_date"), true);
  assert.equal(writes.length, 0);
  assert.equal(booking.matchesDallasMcLeodDetailDate("20261118163000+0000", "20261118103000-0600"), true);
  assert.equal(booking.matchesDallasMcLeodDetailDate("20261118173000+0000", "20261118103000-0600"), false);
  assert.equal(booking.matchesDallasMcLeodDetailDate("20261118163000+0000", "bad date"), false);
});

test("sync moves delivery first when both schedules advance beyond the old delivery date", async () => {
  const original = { write: process.env.DRAY_IMPORT_WRITES_ENABLED, sync: process.env.MCLEOD_SYNC_ENABLED };
  process.env.DRAY_IMPORT_WRITES_ENABLED = process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes, order } = fixture(false, true, undefined, true);
    for (const stop of order.stops) {
      stop.sched_arrive_early = "20261115000000-0600";
      stop.sched_arrive_late = "20261115000000-0600";
    }
    const preview = await (await request("preview-package")).json();
    const applied = await (await request("apply-package", preview.token)).json();
    assert.deepEqual(applied.issues, []);
    assert.deepEqual(writes.filter(write => write.path === "/stop/update").map(write => write.body.id), ["STOP2", "STOP1"]);
  } finally {
    if (original.write === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = original.write;
    if (original.sync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = original.sync;
  }
});

test("regular sync retries pickup against an already verified delivery schedule", async () => {
  const original = { write: process.env.DRAY_IMPORT_WRITES_ENABLED, sync: process.env.MCLEOD_SYNC_ENABLED };
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes, order, tables } = fixture(false, true, undefined, true);
    order.stops[0].sched_arrive_early = "20261115000000-0600";
    order.stops[0].sched_arrive_late = "20261117103000-0600";
    Object.assign(tables.dallas_dray_import_loads.payload.stops[0], order.stops[0]);
    order.stops[1].sched_arrive_early = "20261116000000-0600";
    order.stops[1].sched_arrive_late = "20261118103000-0600";
    const preview = await (await request("preview-load")).json();
    const applied = await (await request("apply-load", preview.token)).json();
    assert.deepEqual(applied.issues, []);
    assert.deepEqual(writes.filter(write => write.path === "/stop/update").map(write => write.body.id), ["STOP1"]);
  } finally {
    if (original.write === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = original.write;
    if (original.sync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = original.sync;
  }
});

test("a blank platform container can clear the McLeod reference with a reviewed order token", async () => {
  const original = { write: process.env.DRAY_IMPORT_WRITES_ENABLED, sync: process.env.MCLEOD_SYNC_ENABLED };
  process.env.DRAY_IMPORT_WRITES_ENABLED = "true";
  process.env.MCLEOD_SYNC_ENABLED = "true";
  try {
    const { request, writes, order, tables } = fixture(true);
    order.blnum = "MARK1";
    order.consignee_refno = "ABCD1234567";
    tables.cotton_outbound_containers.container_number = null;
    const preview = await (await request("preview-load")).json();
    assert.ok(preview.clearContainerToken);
    assert.equal(writes.length, 0);
    order.consignee_refno = "EFGH1234567";
    assert.equal((await request("clear-container", preview.clearContainerToken)).ok, false);
    assert.equal(writes.length, 0);
    order.consignee_refno = "ABCD1234567";
    const cleared = await (await request("clear-container", preview.clearContainerToken)).json();
    assert.deepEqual(cleared.applied, ["McLeod container reference cleared"]);
    assert.equal(order.consignee_refno, "");
    assert.deepEqual(writes, [{ path: "/orders/updateRow",
      body: { __type: "orders", company_id: "TMS", id: orderId, consignee_refno: "" } }]);
  } finally {
    if (original.write === undefined) delete process.env.DRAY_IMPORT_WRITES_ENABLED;
    else process.env.DRAY_IMPORT_WRITES_ENABLED = original.write;
    if (original.sync === undefined) delete process.env.MCLEOD_SYNC_ENABLED;
    else process.env.MCLEOD_SYNC_ENABLED = original.sync;
  }
});

test("regular sync proposes clearing a container that still matches the verified McLeod value", async () => {
  const { request, writes, order, tables } = fixture(false);
  order.blnum = "MARK1";
  order.consignee_refno = "ABCD1234567";
  tables.cotton_outbound_containers.container_number = null;
  tables.dallas_dray_import_loads.payload.outboundSyncedDetails = { consignee_refno: "ABCD1234567" };
  const preview = await (await request("preview-load")).json();
  assert.deepEqual(preview.detailChanges, [{ field: "consignee_refno", before: "ABCD1234567", after: "", required: false }]);
  assert.deepEqual(preview.detailBlockers, []);
  assert.equal(preview.clearContainerToken, null);
  assert.equal(writes.length, 0);
});

test("sync shows the platform's audited edit time on a booking conflict", async () => {
  const { request, order } = fixture(false, true, undefined, false, {
    [bookingId]: { cutoff: "2026-11-16T23:42:00+00:00" },
  });
  order.cutoff_date = "20261119103000-0600";
  const preview = await (await request("preview-load")).json();
  assert.ok(preview.detailBlockers.some(issue =>
    issue.startsWith("cutoff_date:") && issue.includes("Nov 16, 2026, 5:42:00 PM Dallas time")));
});
