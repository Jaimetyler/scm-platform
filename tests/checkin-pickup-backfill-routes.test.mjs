import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as yardHelpers from "../lib/inbound/checkin/yard-stop.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const full = resolve(root, path);
  const output = ts.transpileModule(readFileSync(full, "utf8"), { fileName: full,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/inbound/checkin/yard-stop": yardHelpers, "./yard-stop.ts": yardHelpers,
    "@/lib/auth/guard": { withStaffAccess: handler => handler, staffActor: () => "test staff", staffProfile: () => ({ role: "admin" }) },
    "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database access"); } },
    "@/lib/mcleod/inbound/resolveCustomer": { resolveCustomer: () => { throw new Error("Fixture should have customer_id"); } },
    "@/lib/inbound/checkin/ready": {}, "@/lib/inbound/checkin/process-row": {},
    "@/lib/inbound/checkin/scm-carrier": {}, "@/lib/inbound/checkin/backfill-trucking-company": {},
    "@/lib/inbound/checkin/shortage": {}, ...overrides,
  };
  const module = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (name.startsWith(".") || name.startsWith("@/")) {
      const file = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(full), name);
      return load(existsSync(file) ? file : existsSync(file + ".ts") ? file + ".ts" : file + ".tsx", overrides);
    }
    return require(name);
  };
  new Function("require", "module", "exports", "console", output)(localRequire, module, module.exports, { log() {}, warn() {} });
  return module.exports;
}

async function scenario(options, run) {
  const previousFetch = globalThis.fetch;
  const keys = ["MCLEOD_BASE_URL", "MCLEOD_AUTH_TOKEN", "MCLEOD_SYNC_ENABLED", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = key.endsWith("URL") ? "https://example.invalid" : "test";
  process.env.MCLEOD_SYNC_ENABLED = options.safe ? "false" : "true";
  const pickup = { id: "PU1", stop_type: "PU", location: { name: "Customer Shipper" },
    actual_arrival: "", actual_departure: "", ...options.pickup };
  const delivery = { id: "SO1", stop_type: "SO", location: { name: "SCM Houston 5300" },
    actual_arrival: "", actual_departure: "", sched_arrive_early: "20261002100000-0500", ...options.delivery };
  const order = { id: "ORDER1", status: "A", __statusDescr: "Available", revenue_code_id: "MAIN", commodity_id: "COTTON",
    customer_id: "C1", consignee_refno: "MARK1", blnum: "MARK1 88 BALES", pieces: 88,
    movements: [{ id: "M1", carrier_name: "Test Carrier" }], stops: [pickup, delivery] };
  const row = { source: "live_checkin", terminal: "HOU", receivedDate: "2026-10-02", mark: "MARK1", shipper: "C1",
    bolBC: 88, balesUnloaded: 88, expectedBaleCount: 88, checkedInAt: "2026-10-02T15:12:00Z", verifiedAt: "2026-10-02T16:23:00Z" };
  const writes = [], dbWrites = [];
  let failedDelivery = false;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/orders/ORDER1") return Response.json(order);
    assert.equal(init.method, "POST");
    assert.ok(parsed.pathname.startsWith("/carrierDispatch/clearStop/"));
    const id = parsed.pathname.split("/").at(-1);
    writes.push({ id, arrival: parsed.searchParams.get("arrivalDate"), departure: parsed.searchParams.get("departureDate") });
    if (id === "PU1" && options.failPickup) return new Response("failed", { status: 503 });
    if (id === "SO1" && options.failDeliveryOnce && !failedDelivery) {
      failedDelivery = true; return new Response("failed", { status: 503 });
    }
    const stop = order.stops.find((s) => s.id === id);
    assert.ok(stop);
    stop.actual_arrival = parsed.searchParams.get("arrivalDate");
    stop.actual_departure = parsed.searchParams.get("departureDate");
    return new Response("OK");
  };
  const preview = { status: "Matched", matchedOrderId: "ORDER1", candidateCount: 1,
    resolvedCustomer: { customerId: "C1" }, parsedBlnum: { mark: "MARK1", count: "88" } };
  const sync = load("app/api/inbound/sync/route.ts", {
    "@/lib/mcleod/inbound/buildPreview": { buildPreview: async () => [preview] },
  });
  const checkin = { id: "12345678-1234-4234-8234-123456789012", terminal: "HOU", site_code: "5300",
    material_type: "lumber", movement_direction: "delivery", matched_order_id: "ORDER1", matched_stop_id: "SO1", reference_number: "MARK1",
    yard_status: "working", checked_in_at: row.checkedInAt };
  const query = { select() { return this; }, eq() { return this; }, in() { return this; },
    update(value) { dbWrites.push(value); return this; }, maybeSingle: async () => ({ data: checkin }) };
  const domestic = load("app/api/warehouse/domestic-queue/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ from: () => query }) },
  });
  const post = async () => {
    const response = await sync.POST({ json: async () => ({ row }) });
    return { status: response.status, body: await response.json() };
  };
  const checkout = async () => {
    order.commodity_id = "LUMBER";
    const response = await domestic.PATCH({ headers: new Headers(), json: async () => ({ action: "checkout",
      id: checkin.id, terminal: "HOU", siteCode: "5300" }) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ post, checkout, writes, dbWrites, row, order, pickup, delivery, checkin }); }
  finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
}

test("live cotton writes previous-day pickup before real delivery timestamps", async () => {
  await scenario({}, async ({ post, writes }) => {
    const { body } = await post();
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.deepEqual(writes, [
      { id: "PU1", arrival: "20261001080000-0500", departure: "20261001080500-0500" },
      { id: "SO1", arrival: "20261002101200-0500", departure: "20261002112300-0500" },
    ]);
    assert.equal(body.plannedActions.pickup.generatedArrival, true);
    assert.equal(body.mcleodResponse.pickup.ok, true);
  });
});

test("live cotton preserves existing pickup and partial delivery actuals", async () => {
  await scenario({ pickup: { actual_arrival: "20261001070000-0500", actual_departure: "20261001071000-0500" },
    delivery: { actual_arrival: "20261002094500-0500" } }, async ({ post, writes }) => {
    assert.equal((await post()).body.ok, true);
    assert.deepEqual(writes, [{ id: "SO1", arrival: "20261002094500-0500", departure: "20261002112300-0500" }]);
  });
});

test("live cotton fills a missing pickup departure without replacing arrival", async () => {
  await scenario({ pickup: { actual_arrival: "20261001073000-0500" } }, async ({ post, writes }) => {
    assert.equal((await post()).body.ok, true);
    assert.equal(writes[0].arrival, "20261001073000-0500");
    assert.equal(writes[0].departure, "20261001080500-0500");
  });
});

test("pickup failure prevents cotton delivery posting", async () => {
  await scenario({ failPickup: true }, async ({ post, writes }) => {
    const { body } = await post();
    assert.equal(body.ok, false);
    assert.equal(body.reason, "PICKUP_CLEAR_STOP_FAILED");
    assert.deepEqual(writes.map((w) => w.id), ["PU1"]);
  });
});

test("retry after delivery failure does not rewrite completed pickup", async () => {
  await scenario({ failDeliveryOnce: true }, async ({ post, writes }) => {
    assert.equal((await post()).body.ok, false);
    assert.equal((await post()).body.ok, true);
    assert.deepEqual(writes.map((w) => w.id), ["PU1", "SO1", "SO1"]);
  });
});

test("preview mode shows pickup fallback but performs no McLeod writes", async () => {
  await scenario({ safe: true }, async ({ post, writes }) => {
    const { body } = await post();
    assert.equal(body.mode, "safe");
    assert.equal(body.plannedActions.pickup.arrivalDate, "20261001080000-0500");
    assert.equal(writes.length, 0);
  });
});

test("shortages, reference mismatch, invalid dates and reversed chronology block before writes", async () => {
  for (const change of [({ row }) => { row.balesUnloaded = 80; }, ({ row }) => { row.mark = "WRONG"; },
    ({ row }) => { row.receivedDate = "bad date"; }, ({ row }) => { row.verifiedAt = "2026-10-01T00:00:00Z"; },
    ({ pickup }) => { pickup.actual_arrival = "20261001100000-0500"; }]) {
    await scenario({}, async (state) => {
      change(state);
      assert.equal((await state.post()).body.ok, false);
      assert.equal(state.writes.length, 0);
    });
  }
});

test("lumber delivery checkout also fills pickup first and preserves delivery arrival", async () => {
  await scenario({ delivery: { actual_arrival: "20261002094500-0500" } }, async ({ checkout, writes, dbWrites }) => {
    const { body } = await checkout();
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.deepEqual(writes.map((w) => w.id), ["PU1", "SO1"]);
    assert.equal(writes[0].arrival, "20261001080000-0500");
    assert.equal(writes[1].arrival, "20261002094500-0500");
    assert.equal(dbWrites[0].yard_status, "completed");
  });
});

test("lumber pickup failure leaves both delivery and checkout unposted", async () => {
  await scenario({ failPickup: true }, async ({ checkout, writes, dbWrites }) => {
    assert.equal((await checkout()).body.ok, false);
    assert.deepEqual(writes.map((w) => w.id), ["PU1"]);
    assert.equal(dbWrites.length, 0);
  });
});

test("lumber checkout retries delivery after successful pickup without rewriting it", async () => {
  await scenario({ failDeliveryOnce: true }, async ({ checkout, writes, dbWrites }) => {
    assert.equal((await checkout()).body.ok, false);
    assert.equal(dbWrites.length, 0);
    assert.equal((await checkout()).body.ok, true);
    assert.deepEqual(writes.map((w) => w.id), ["PU1", "SO1", "SO1"]);
    assert.equal(dbWrites.length, 1);
  });
});

test("lumber pickup checkout does not backfill a delivery or another pickup", async () => {
  await scenario({}, async ({ checkout, writes, order, checkin }) => {
    order.stops[0].location = { name: "SCM Houston 5300" };
    order.stops[1].location = { name: "Customer Receiver" };
    checkin.movement_direction = "pickup"; checkin.matched_stop_id = "PU1";
    assert.equal((await checkout()).body.ok, true);
    assert.deepEqual(writes.map((w) => w.id), ["PU1"]);
    assert.equal(writes[0].arrival, "20261002101200-0500");
  });
});

test("saved selected stop disappears or changes yard or direction: checkout writes nothing", async () => {
  for (const change of [({ checkin }) => { checkin.matched_stop_id = "MISSING"; },
    ({ delivery }) => { delivery.location = { name: "SCM Houston 4331" }; },
    ({ delivery }) => { delivery.stop_type = "PU"; }]) {
    await scenario({}, async state => {
      change(state);
      const result = await state.checkout();
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.equal(state.writes.length, 0); assert.equal(state.dbWrites.length, 0);
    });
  }
});

test("delivery checkout never backfills another movement's pickup", async () => {
  await scenario({}, async ({ order, pickup, delivery, checkout, writes }) => {
    pickup.movement_id = "WRONG"; delivery.movement_id = "RIGHT";
    order.movements = [{ id: "WRONG" }, { id: "RIGHT" }];
    order.stops.push({ id: "RIGHTPU", movement_id: "RIGHT", stop_type: "PU", location: { name: "Customer Shipper" } });
    assert.equal((await checkout()).body.ok, true);
    assert.deepEqual(writes.map(item => item.id), ["RIGHTPU", "SO1"]);
  });
});

test("ambiguous pickup movement cannot authorize delivery checkout", async () => {
  await scenario({}, async ({ order, delivery, checkout, writes, dbWrites }) => {
    delivery.movement_id = "RIGHT";
    order.movements = [{ id: "WRONG" }, { id: "RIGHT" }];
    const result = await checkout();
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(writes.length, 0); assert.equal(dbWrites.length, 0);
  });
});

test("new checkout rejects a changed reference, material, or closed order before writes", async () => {
  for (const change of [({ checkin }) => { checkin.reference_number = "CHANGED"; },
    ({ checkin }) => { checkin.material_type = "other"; },
    ({ order }) => { order.__statusDescr = "Closed"; }]) {
    await scenario({}, async state => {
      change(state); const result = await state.checkout();
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.equal(state.writes.length, 0); assert.equal(state.dbWrites.length, 0);
    });
  }
});

test("legacy unbound arrival requires a fresh unique stop and persists it before writes", async () => {
  await scenario({}, async ({ checkin, checkout, dbWrites, writes }) => {
    checkin.matched_stop_id = null;
    assert.equal((await checkout()).body.ok, true);
    assert.equal(dbWrites[0].matched_stop_id, "SO1");
    assert.deepEqual(writes.map(item => item.id), ["PU1", "SO1"]);
  });
  await scenario({}, async ({ checkin, order, checkout, writes, dbWrites }) => {
    checkin.matched_stop_id = null;
    order.stops.push({ id: "SECOND", stop_type: "SO", location: { name: "SCM Houston 5300" } });
    const result = await checkout();
    assert.equal(result.status, 409); assert.equal(writes.length, 0); assert.equal(dbWrites.length, 0);
  });
});

test("delivery checkout never invents actuals for a same-yard pickup with unverified sequence", async () => {
  await scenario({}, async ({ order, pickup, delivery, checkout, writes, dbWrites }) => {
    pickup.location = { name: "SCM Houston 5300" };
    order.stops = [delivery, pickup];
    const result = await checkout();
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(writes.length, 0); assert.equal(dbWrites.length, 0);
  });
});

test("complete earlier same-yard pickup actuals remain usable without rewriting them", async () => {
  await scenario({ pickup: { location: { name: "SCM Houston 5300" },
    actual_arrival: "20261001070000-0500", actual_departure: "20261001071000-0500" } }, async ({ checkout, writes }) => {
    const result = await checkout();
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    assert.deepEqual(writes.map(item => item.id), ["SO1"]);
  });
});
