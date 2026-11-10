import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as referenceHelpers from "../lib/inbound/checkin/reference-match.ts";
import * as lookupFailureHelpers from "../lib/inbound/checkin/lookup-failure.ts";
import * as referenceSearch from "../lib/inbound/checkin/reference-search.ts";
import * as driverHelpers from "../lib/inbound/checkin/driver-lookup.ts";
import * as orderHelpers from "../lib/inbound/checkin/mcleod-order-id.ts";
import * as timeHelpers from "../lib/inbound/checkin/mcleod-time.ts";
import * as yardHelpers from "../lib/inbound/checkin/yard-stop.ts";
import * as dependencyHelpers from "../lib/http/dependency.ts";
import { mapLimit } from "../lib/http/map-limit.ts";
import { extractSearchOrders } from "../lib/mcleod/inbound/search-response.ts";
import { CHECKIN_SITES } from "../lib/inbound/checkin/sites.ts";
import { warehouseDate } from "../lib/inbound/checkin/geofence.ts";

const require = createRequire(import.meta.url);
const compiled = new Map();
const token = "12345678-1234-4234-8234-123456789012";
const gate = { id: "GATE", terminal: "HOU", site_code: "5300", site_name: "Houston 5300", latitude: 1, longitude: 1, radius_m: 200 };

// Execute the real handlers and reference/order helpers. Only HTTP, auth, GPS,
// and database boundaries are fixtures; nothing can contact a live service.
function load(path, database) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  const modules = {
    "next/server": { NextResponse: Response },
    "@supabase/supabase-js": { createClient: () => database },
    "@/lib/auth/guard": { withStaffAccess: handler => handler, staffActor: () => "test staff" },
    "@/lib/http/dependency": dependencyHelpers,
    "@/lib/http/map-limit": { mapLimit },
    "@/lib/inbound/checkin/reference-match": referenceHelpers,
    "@/lib/inbound/checkin/lookup-failure": lookupFailureHelpers,
    "@/lib/inbound/checkin/reference-search": referenceSearch,
    "@/lib/inbound/checkin/driver-lookup": driverHelpers,
    "@/lib/inbound/checkin/mcleod-order-id": orderHelpers,
    "@/lib/inbound/checkin/mcleod-time": timeHelpers,
    "@/lib/inbound/checkin/yard-stop": yardHelpers,
    "@/lib/inbound/checkin/sites": { CHECKIN_SITES },
    "@/lib/mcleod/inbound/search-response": { extractSearchOrders },
    "@/lib/inbound/checkin/geofence": { warehouseDate, verifyGateLocation: () => ({ ok: true, distanceMeters: 0 }) },
    "@/lib/inbound/checkin/container-device": {},
    "@/lib/inbound/checkin/shortage": { cottonShortage: () => null },
    "@/lib/inbound/checkin/ready": {},
    "@/lib/inbound/checkin/process-row": {},
    "@/lib/inbound/checkin/display-carrier": {},
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.get(path))(name => modules[name] || require(name), module, module.exports);
  return module.exports;
}

async function scenario({ value = "2951 / 4500281026", input = "2951", direction = "pickup", searchValue = value,
  searchRows, readOverride } = {}, run) {
  const savedFetch = globalThis.fetch;
  const names = ["MCLEOD_BASE_URL", "MCLEOD_AUTH_TOKEN", "MCLEOD_SYNC_ENABLED", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const savedEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => process.env[name] = name.endsWith("URL") ? "https://fixture.invalid" : "fixture");
  process.env.MCLEOD_SYNC_ENABLED = "true";
  const stopId = direction === "pickup" ? "PU1" : "SO1";
  const field = direction === "pickup" ? "blnum" : "consignee_refno";
  const order = { id: "ORDER1", status: "A", revenue_code_id: "MAIN", customer_id: "CUSTOMER", commodity_id: "LUMBER",
    blnum: "UNRELATED PICKUP", consignee_refno: "UNRELATED DELIVERY", [field]: value,
    movements: [{ id: "M1", carrier_name: "Actual Carrier" }], stops: [
      { id: "PU1", movement_id: "M1", stop_type: "PU", sched_arrive_early: new Date().toISOString(),
        location: { name: direction === "pickup" ? "SCM Houston 5300" : "Customer Shipper" },
        actual_arrival: direction === "delivery" ? "20260101080000-0600" : "",
        actual_departure: direction === "delivery" ? "20260101080500-0600" : "" },
      { id: "SO1", movement_id: "M1", stop_type: "SO", sched_arrive_early: new Date().toISOString(),
        location: { name: direction === "delivery" ? "SCM Houston 5300" : "Customer Receiver" } },
    ] };
  const row = { id: token, updated_at: "revision", terminal: "HOU", site_code: "5300", material_type: "lumber",
    movement_direction: direction, reference_number: input, matched_order_id: "ORDER1", matched_stop_id: stopId,
    yard_status: "working", checked_in_at: new Date(Date.now() - 60000).toISOString() };
  const referenceRows = searchRows ? searchRows(order, field) : [{ ...order, [field]: searchValue }];
  const ordersById = new Map(referenceRows.filter(item => item && typeof item === "object").map(item => [item.id, item]));
  ordersById.set(order.id, order);
  const dbWrites = [], mcleodWrites = [], calls = [];
  const database = { from(table) {
    let written;
    const result = () => ({ data: table === "driver_checkin_sites" ? gate : { ...row, ...written } });
    return { select() { return this; }, eq() { return this; }, in() { return this; }, or() { return this; },
      limit: async () => ({ data: [] }), single: async () => result(), maybeSingle: async () => result(),
      insert(value) { written = value; dbWrites.push({ action: "insert", value }); return this; },
      update(value) { written = value; dbWrites.push({ action: "update", value }); return this; } };
  } };
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://fixture.invalid"); calls.push(parsed);
    if (init.method === "POST") {
      assert.ok(parsed.pathname.startsWith("/carrierDispatch/clearStop/"));
      mcleodWrites.push(parsed.pathname.split("/").at(-1)); return new Response("OK");
    }
    assert.ok(!init.method || init.method === "GET");
    if (readOverride) {
      const overridden = await readOverride(parsed, init, referenceRows);
      if (overridden !== undefined) return overridden;
    }
    if (parsed.pathname === "/orders/search") {
      if (parsed.searchParams.has("orders.id")) return Response.json(parsed.searchParams.get("orders.id") === order.id ? [order] : []);
      const offset = Number(parsed.searchParams.get("recordOffset") || 0);
      const length = Number(parsed.searchParams.get("recordLength"));
      return Response.json(parsed.searchParams.has(`orders.${field}`) ? referenceRows.slice(offset, offset + length) : []);
    }
    assert.ok(parsed.pathname.startsWith("/orders/"));
    const detail = ordersById.get(decodeURIComponent(parsed.pathname.split("/").at(-1)));
    assert.ok(detail, "Only discovered order IDs may be hydrated"); return Response.json(detail);
  };
  const staff = load("app/api/warehouse/domestic-queue/route.ts", database);
  const search = load("app/api/warehouse/domestic-queue/match/route.ts", database).GET;
  const qr = load("app/api/gate/check-in/[token]/route.ts", database).POST;
  const result = async response => ({ status: response.status, body: await response.json() });
  const staffBody = { terminal: "HOU", siteCode: "5300", movementDirection: direction, materialType: "lumber",
    orderId: order.id, selectedStopId: stopId, referenceNumber: input };
  const sendQr = async body => result(await qr(new Request("https://scm.invalid", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) }));
  try {
    await run({ order, row, stopId, dbWrites, mcleodWrites, calls,
      search: async ({ strictDirection = "1" } = {}) => result(await search({ url: `https://scm.invalid?${new URLSearchParams({ ...staffBody, strictDirection })}` })),
      create: async () => result(await staff.POST({ json: async () => staffBody })),
      rematch: async () => result(await staff.PATCH({ json: async () => ({ ...staffBody, action: "match_order", id: token, expectedUpdatedAt: row.updated_at }) })),
      checkout: async () => result(await staff.PATCH({ json: async () => ({ ...staffBody, action: "checkout", id: token }) })),
      qrLookup: async () => sendQr({ action: "lookupReference", referenceNumber: input, movementDirection: direction }),
      qrSubmit: async () => sendQr({ ...staffBody, clientId: token, checkinType: "domestic", driverLookupInput: input,
        driverName: "Driver", driverPhone: "555-0100", truckingCompany: "Driver Company", destination: "Receiver" }),
    });
  } finally {
    globalThis.fetch = savedFetch;
    names.forEach(name => savedEnv[name] === undefined ? delete process.env[name] : process.env[name] = savedEnv[name]);
  }
}

test("staff search, create, rematch, checkout, and QR submission accept either full reference token", async () => {
  for (const direction of ["pickup", "delivery"]) for (const input of ["2951", "4500281026", "2951 / 4500281026"]) {
    await scenario({ input, direction }, async h => {
      const found = await h.search();
      assert.equal(found.status, 200, JSON.stringify(found.body));
      assert.deepEqual(found.body.matches.map(match => [match.orderId, match.stopId]), [["ORDER1", h.stopId]]);
      for (const action of [h.create, h.rematch]) {
        const response = await action(); assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(h.dbWrites.at(-1).value.matched_order_id, "ORDER1");
        assert.equal(h.dbWrites.at(-1).value.matched_stop_id, h.stopId);
      }
      assert.equal(h.dbWrites.at(-1).value.reference_number, "2951 / 4500281026");
      const lookup = await h.qrLookup();
      assert.equal(lookup.status, 200, JSON.stringify(lookup.body)); assert.equal(lookup.body.status, "matches");
      const submit = await h.qrSubmit(); assert.equal(submit.status, 200, JSON.stringify(submit.body));
      assert.equal(h.dbWrites.at(-1).value.reference_number, "2951 / 4500281026");
      assert.equal(h.dbWrites.at(-1).value.driver_lookup_input, input);
      assert.equal(h.dbWrites.at(-1).value.matched_stop_id, h.stopId);
      const checkout = await h.checkout(); assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
      assert.deepEqual(h.mcleodWrites, [h.stopId]);
    });
  }
});

test("partial, leading-zero, and mixed-input references cannot authorize search selections or writes", async () => {
  for (const direction of ["pickup", "delivery"]) for (const [value, input] of [
    ["129510", "2951"], ["002951", "2951"], ["2951 / 4500281026", "2951 / WRONG"], ["ABC2951/OTHER", "2951"],
  ]) await scenario({ value, input, direction }, async h => {
    const found = await h.search(); assert.equal(found.status, 200); assert.deepEqual(found.body.matches, []);
    assert.equal(h.calls.filter(call => call.pathname === "/orders/ORDER1").length, 0, "Reject partial search rows before hydration");
    for (const action of [h.create, h.rematch, h.checkout]) {
      const response = await action(); assert.equal(response.status, 409, JSON.stringify(response.body));
    }
    const qr = await h.qrSubmit(); assert.equal(qr.status, 409, JSON.stringify(qr.body));
    assert.deepEqual(h.dbWrites, []); assert.deepEqual(h.mcleodWrites, []);
  });
});

test("staff hydration rechecks the whole input when the upstream reference changes", async () => {
  for (const direction of ["pickup", "delivery"]) await scenario({ value: "129510", searchValue: "2951 / 4500281026", direction }, async h => {
    const found = await h.search(); assert.equal(found.status, 503); assert.equal(found.body.matches, undefined);
    assert.equal(h.calls.filter(call => call.pathname === "/orders/ORDER1").length, 1);
    assert.deepEqual(h.dbWrites, []); assert.deepEqual(h.mcleodWrites, []);
  });
});

test("staff cannot mistake incomplete or unrelated hydrated orders for verified absence", async () => {
  for (const change of [
    order => { order.id = "UNRELATED"; },
    order => { order.stops = []; },
    order => { order.stops[0].location = {}; },
    order => { delete order.stops[0].id; },
    order => { delete order.stops[0].stop_type; },
    order => { order.stops[0].location.name = "SCM Houston"; },
    order => { delete order.revenue_code_id; },
    order => { delete order.customer_id; },
  ]) await scenario({}, async h => {
    change(h.order);
    const response = await h.search(); assert.equal(response.status, 503, JSON.stringify(response.body));
    assert.equal(response.body.matches, undefined);
    assert.deepEqual(h.dbWrites, []); assert.deepEqual(h.mcleodWrites, []);
  });
});

test("staff still excludes known other-yard and non-MAIN orders and retains completed matches", async () => {
  for (const change of [order => { order.stops[0].location.name = "SCM Houston 4331"; },
    order => { order.revenue_code_id = "OTHER"; }]) await scenario({}, async h => {
    change(h.order);
    const response = await h.search(); assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.matches, []);
  });
  await scenario({}, async h => {
    h.order.stops[0].actual_departure = "20260101080000-0600";
    h.order.stops[0].sched_arrive_early = "20260101070000-0600";
    const response = await h.search(); assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.matches.length, 1); assert.equal(response.body.matches[0].completion.kind, "pickup");
  });
});

test("staff and QR retain exact hyphenated identifiers and delimiter-bounded whole input", async () => {
  for (const [value, input] of [["AB12-CD34", "ab12-cd34"], ["REF AB12-CD34/OTHER", "ab12-cd34"],
    ["2951-4500281026", "4500281026"], ["002951 / OTHER", "002951"]]) {
    await scenario({ value, input }, async h => {
      assert.equal((await h.search()).body.matches.length, 1);
      for (const action of [h.create, h.rematch, h.qrSubmit, h.checkout]) {
        const response = await action(); assert.equal(response.status, 200, JSON.stringify(response.body));
      }
      assert.deepEqual(h.mcleodWrites, [h.stopId]);
    });
  }
});

test("staff and QR page through false substrings before finding either token on the same order", async () => {
  for (const input of ["2951", "4500281026"]) await scenario({ input, searchRows: (order, field) => [
    ...Array.from({ length: 7 }, (_, index) => ({ ...order, id: `FALSE${index}`, [field]: `1${input}0` })), order,
  ] }, async h => {
    const staff = await h.search(); assert.equal(staff.status, 200, JSON.stringify(staff.body));
    assert.deepEqual(staff.body.matches.map(match => match.orderId), ["ORDER1"]);
    const staffPages = h.calls.filter(call => call.searchParams.has("orders.blnum"));
    assert.deepEqual(staffPages.map(call => call.searchParams.get("recordOffset")), ["0", "5"]);
    assert.ok(staffPages.every(call => call.searchParams.get("recordLength") === "5"));
    const driver = await h.qrLookup(); assert.equal(driver.status, 200, JSON.stringify(driver.body));
    assert.deepEqual(driver.body.matches.map(match => match.orderId), ["ORDER1"]);
    assert.ok(h.calls.filter(call => call.pathname.startsWith("/orders/") && call.pathname !== "/orders/search")
      .every(call => call.pathname === "/orders/ORDER1"), "False substring rows are never hydrated");
  });
});

test("an exact whole-field reference never suppresses a second order containing the whole token", async () => {
  await scenario({ searchRows: (order, field) => [order, { ...order, id: "ORDER2", [field]: "2951" }] }, async h => {
    for (const action of [h.search, h.qrLookup]) {
      const response = await action(); assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.matches.map(match => match.orderId).sort(), ["ORDER1", "ORDER2"]);
    }
    assert.deepEqual(h.dbWrites, []); assert.deepEqual(h.mcleodWrites, []);
  });
});

test("staff never returns a partial match list when later pages or the alternate field fail", async () => {
  const rows = (order, field) => [order, ...Array.from({ length: 4 }, (_, index) => ({ ...order, id: `FALSE${index}`, [field]: "129510" }))];
  for (const failure of ["later-status", "later-shape", "overlap", "alternate-field"]) {
    await scenario({ searchRows: rows, readOverride: (url, _init, referenceRows) => {
      if (url.pathname !== "/orders/search") return;
      if (failure === "alternate-field" && url.searchParams.has("orders.consignee_refno")) return new Response("failed", { status: 503 });
      if (url.searchParams.get("recordOffset") === "5") {
        if (failure === "later-status") return new Response("failed", { status: 503 });
        if (failure === "later-shape") return Response.json({ error: "malformed page" });
        if (failure === "overlap") return Response.json(referenceRows);
      }
    } }, async h => {
      const response = await h.search({ strictDirection: failure === "alternate-field" ? "0" : "1" });
      assert.equal(response.status, 503, `${failure}: ${JSON.stringify(response.body)}`);
      assert.equal(response.body.ok, false); assert.equal(response.body.matches, undefined);
      assert.equal(h.calls.filter(call => call.pathname === "/orders/ORDER1").length, 0);
      assert.deepEqual(h.dbWrites, []); assert.deepEqual(h.mcleodWrites, []);
    });
  }
});

test("staff exhausting its bounded raw-row budget cannot report a match or absence", async () => {
  await scenario({ searchRows: (order, field) => Array.from({ length: 100 }, (_, index) => ({ ...order,
    id: `FALSE${String(index).padStart(3, "0")}`, [field]: "129510" })) }, async h => {
    const response = await h.search(); assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.ok, false); assert.equal(response.body.matches, undefined);
    const pages = h.calls.filter(call => call.searchParams.has("orders.blnum"));
    assert.equal(pages.length, 20); assert.equal(pages.at(-1).searchParams.get("recordOffset"), "95");
    assert.equal(h.calls.filter(call => call.pathname === "/orders/ORDER1").length, 0);
  });
});

test("staff uses one whole-lookup deadline through search bodies, detail bodies, and enrichment", async () => {
  const savedTimeout = AbortSignal.timeout;
  for (const stage of ["search-body", "detail-body", "enrichment-body"]) {
    const deadline = new AbortController();
    let budgets = 0;
    AbortSignal.timeout = ms => {
      if (ms === 20_000) { budgets++; return deadline.signal; }
      return savedTimeout(ms);
    };
    try {
      await scenario({ readOverride: (url, init) => {
        const stall = stage === "search-body" && url.pathname === "/orders/search" ||
          stage === "detail-body" && url.pathname === "/orders/ORDER1" ||
          stage === "enrichment-body" && url.pathname.startsWith("/carriers/");
        if (!stall) return;
        return { ok: true, json: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
          setImmediate(() => deadline.abort(new DOMException("Fixture deadline", "TimeoutError")));
        }) };
      } }, async h => {
        if (stage === "enrichment-body") h.order.movements[0] = { id: "M1", carrier_id: "CARRIER" };
        const response = await h.search({ strictDirection: "0" });
        assert.equal(response.status, 503, `${stage}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.matches, undefined); assert.equal(budgets, 1);
        assert.deepEqual(h.dbWrites, []); assert.deepEqual(h.mcleodWrites, []);
      });
    } finally { AbortSignal.timeout = savedTimeout; }
  }
});

test("staff preserves four-wide hydration while collecting paged candidates", async () => {
  let active = 0, maxActive = 0;
  await scenario({ searchRows: (order) => Array.from({ length: 9 }, (_, index) => ({ ...order, id: `ORDER${index}` })),
    readOverride: async (url, _init, referenceRows) => {
      if (url.pathname === "/orders/search") return;
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return Response.json(referenceRows.find(order => `/orders/${order.id}` === url.pathname));
    } }, async h => {
    const response = await h.search(); assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.matches.length, 9); assert.equal(maxActive, 4);
  });
});

test("staff and QR preserve both compound tokens across slash-spacing variants", async () => {
  const values = ["81382 / 49001932", "81382/ 49001932", "81382 /49001932", "81382/49001932"];
  for (const direction of ["pickup", "delivery"]) for (const value of values)
    for (const input of [...values, "81382", "49001932"]) {
      await scenario({ value, input, direction, readOverride: (url, _init, rows) => {
        const field = direction === "pickup" ? "blnum" : "consignee_refno";
        const pattern = url.searchParams.get(`orders.${field}`);
        if (url.pathname !== "/orders/search" || pattern === null) return;
        // Model the upstream literal contains filter instead of returning the
        // fixture independently of the actual retrieval query.
        assert.ok(pattern.startsWith("*") && pattern.endsWith("*"));
        const anchor = pattern.slice(1, -1);
        const found = rows.filter(row => row[field].toUpperCase().includes(anchor.toUpperCase()));
        const offset = Number(url.searchParams.get("recordOffset") || 0);
        return Response.json(found.slice(offset, offset + Number(url.searchParams.get("recordLength"))));
      } }, async h => {
        const found = await h.search();
        assert.equal(found.status, 200, JSON.stringify({ value, input, direction, body: found.body }));
        assert.deepEqual(found.body.matches.map(match => match.orderId), ["ORDER1"]);
        const lookup = await h.qrLookup();
        assert.equal(lookup.status, 200); assert.equal(lookup.body.status, "matches");
        for (const action of [h.create, h.rematch, h.qrSubmit, h.checkout]) {
          const result = await action(); assert.equal(result.status, 200, JSON.stringify(result.body));
        }
        const qrInsert = h.dbWrites.findLast(write => write.action === "insert" && write.value.driver_lookup_input);
        assert.equal(qrInsert.value.driver_lookup_input, input);
        assert.equal(qrInsert.value.reference_number, value);
        assert.deepEqual(h.mcleodWrites, [h.stopId]);
      });
    }
});
