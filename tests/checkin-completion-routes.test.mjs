import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as orderHelpers from "../lib/inbound/checkin/mcleod-order-id.ts";
import { currentCottonOrder } from "../lib/inbound/checkin/current-cotton-order.ts";
import { CHECKIN_SITES } from "../lib/inbound/checkin/sites.ts";
import { extractSearchOrders } from "../lib/mcleod/inbound/search-response.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
// Execute real route handlers with only HTTP framework and database boundaries
// replaced. McLeod search/detail responses are fixtures; no live writes occur.
function load(path, overrides = {}) {
  const full = resolve(root, path);
  const source = ts.transpileModule(readFileSync(full, "utf8"), { fileName: full,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const defaults = {
    "next/server": { NextResponse: Response },
    "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database access"); } },
    "@/lib/inbound/checkin/mcleod-order-id": orderHelpers,
    "@/lib/inbound/checkin/current-cotton-order": { currentCottonOrder },
    "@/lib/inbound/checkin/sites": { CHECKIN_SITES },
    "@/lib/mcleod/inbound/search-response": { extractSearchOrders },
    "@/lib/mcleod/inbound/utils": { normalizeKey: (v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, "") },
    "@/lib/mcleod/inbound/xref": { CUSTOMER_XREF: [] },
    "@/lib/inbound/checkin/geofence": { verifyGateLocation: () => ({ ok: true, distanceMeters: 0 }), warehouseDate: () => "2026-10-02" },
    "@/lib/inbound/checkin/container-device": {},
    "@/lib/inbound/checkin/shortage": {},
    "@/lib/inbound/checkin/ready": {},
    "@/lib/inbound/checkin/process-row": {},
    "@/lib/inbound/checkin/scm-carrier": {},
    "@/lib/inbound/checkin/backfill-trucking-company": {},
  };
  const modules = { ...defaults, ...overrides };
  const module = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (name.startsWith(".") || name.startsWith("@/")) {
      const file = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(full), name);
      return load(existsSync(file + ".ts") ? file + ".ts" : file + ".tsx", overrides);
    }
    return require(name);
  };
  new Function("require", "module", "exports", source)(localRequire, module, module.exports);
  return module.exports;
}

function fixture({ cotton = false, closed = true, orderStatus = "Available" } = {}) {
  return { id: "0824528", revenue_code_id: "MAIN", customer_id: "CUSTOMER", __statusDescr: orderStatus,
    blnum: cotton ? "TESTMARK 88 BALES" : "2168418 / 1479334", consignee_refno: cotton ? "TESTMARK" : "7799F",
    commodity_id: cotton ? "COTTON" : "LUMBER", movements: [{ id: "OLD", carrier: { name: "Delivered It Trucking" } }],
    stops: [{ id: "SCMSTOP", movement_id: "OLD", stop_type: cotton ? "SO" : "PU",
      actual_departure: closed ? "20260101090000-0500" : "",
      sched_arrive_early: closed ? "20260101070000-0500" : new Date().toISOString(),
      location: { name: "SCM Houston 5300", address1: "5300 Warehouse Road" } }] };
}

async function withMcleod(order, run, searchResponse = () => [order]) {
  const savedFetch = globalThis.fetch;
  const keys = ["MCLEOD_BASE_URL", "MCLEOD_AUTH_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = key.endsWith("URL") ? "https://example.invalid" : "test";
  globalThis.fetch = async (url, init) => {
    assert.ok(!init?.method || init.method === "GET", "Search must never mutate McLeod");
    const path = new URL(url);
    return Response.json(path.pathname.endsWith("/search") ? searchResponse(path) : order);
  };
  try { await run(); } finally {
    globalThis.fetch = savedFetch;
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
}

test("staff cotton lookup retains completed deliveries older than 45 days", async () => {
  await withMcleod(fixture({ cotton: true }), async () => {
    const { GET } = load("app/api/inbound/checkin/cotton-match/route.ts");
    const response = await GET({ nextUrl: new URL("https://scm.test/?terminal=HOU&siteCode=5300&mark=TESTMARK") });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.matches.length, 1);
    assert.equal(body.matches[0].completion.kind, "delivery");
    assert.equal(body.matches[0].carrierName, "Delivered It Trucking");
    assert.equal(body.incomplete, false);
  });
});

test("staff domestic lookup keeps completed pickup and accepts either BL token", async () => {
  await withMcleod(fixture(), async () => {
    const { GET } = load("app/api/warehouse/domestic-queue/match/route.ts");
    for (const ref of ["2168418", "1479334"]) {
      const response = await GET({ url: `https://scm.test/?terminal=HOU&siteCode=5300&movementDirection=pickup&referenceNumber=${ref}` });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.matches.length, 1);
      assert.equal(body.matches[0].completion.kind, "pickup");
      assert.equal(body.matches[0].carrierName, "Delivered It Trucking");
    }
  });
});

test("active domestic result remains selectable", async () => {
  await withMcleod(fixture({ closed: false }), async () => {
    const { GET } = load("app/api/warehouse/domestic-queue/match/route.ts");
    const response = await GET({ url: "https://scm.test/?terminal=HOU&siteCode=5300&movementDirection=pickup&referenceNumber=2168418" });
    const body = await response.json();
    assert.equal(body.matches.length, 1);
    assert.equal(body.matches[0].completion, null);
  });
});

test("1601 BL matches survive a null consignee-reference response", async () => {
  for (const material of ["LUMBER", "FAK"]) {
    const order = fixture({ closed: false });
    order.commodity_id = material;
    order.stops[0].location = { name: "Supply Chain Management 7-3fcfs", address1: "1601 OLD AUGUSTA RD S" };
    await withMcleod(order, async () => {
      const { GET } = load("app/api/warehouse/domestic-queue/match/route.ts");
      for (const reference of ["2168418", "1479334", "2168418 / 1479334"]) {
        const query = new URLSearchParams({ terminal: "SAV", siteCode: "1601", movementDirection: "pickup", referenceNumber: reference });
        const response = await GET({ url: `https://scm.test/?${query}` });
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(body.matches.length, 1);
        assert.equal(body.matches[0].orderId, "0824528");
        assert.equal(body.matches[0].completion, null);
        assert.equal(body.matches[0].materialType, material === "LUMBER" ? "lumber" : "other");
      }
    }, (url) => url.searchParams.has("orders.blnum") ? [order] : null);
  }
});

test("a delivery match survives a null BL response", async () => {
  const order = fixture({ closed: false });
  order.stops[0].stop_type = "SO";
  await withMcleod(order, async () => {
    const { GET } = load("app/api/warehouse/domestic-queue/match/route.ts");
    const response = await GET({ url: "https://scm.test/?terminal=HOU&siteCode=5300&movementDirection=delivery&referenceNumber=7799F" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.matches.length, 1);
    assert.equal(body.matches[0].direction, "delivery");
  }, (url) => url.searchParams.has("orders.consignee_refno") ? [order] : null);
});

test("two null results mean no match, but an unexpected object remains an error", async () => {
  for (const payload of [null, { error: "Upstream search failed" }]) {
    await withMcleod(fixture(), async () => {
      const { GET } = load("app/api/warehouse/domestic-queue/match/route.ts");
      const response = await GET({ url: "https://scm.test/?terminal=HOU&siteCode=5300&movementDirection=pickup&referenceNumber=NOTFOUND" });
      const body = await response.json();
      assert.equal(response.status, payload === null ? 200 : 500);
      if (payload === null) assert.deepEqual(body.matches, []);
      else assert.match(body.error, /unexpected search response/);
    }, () => payload);
  }
});

test("an HTTP failure with a null body remains a search failure", async () => {
  await withMcleod(fixture(), async () => {
    globalThis.fetch = async () => Response.json(null, { status: 503 });
    const { GET } = load("app/api/warehouse/domestic-queue/match/route.ts");
    const response = await GET({ url: "https://scm.test/?terminal=HOU&siteCode=5300&movementDirection=pickup&referenceNumber=2168418" });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /McLeod search failed \(503\)/);
  });
});

test("cotton lookup also accepts an empty alternate-reference result", async () => {
  const order = fixture({ cotton: true });
  await withMcleod(order, async () => {
    const { GET } = load("app/api/inbound/checkin/cotton-match/route.ts");
    const response = await GET({ nextUrl: new URL("https://scm.test/?terminal=HOU&siteCode=5300&mark=TESTMARK") });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.matches.length, 1);
    assert.equal(body.matches[0].completion.kind, "delivery");
    assert.equal(body.incomplete, false);
  }, (url) => url.searchParams.has("orders.consignee_refno") ? [order] : null);
});

test("staff create rejects completed and status-only closed orders before database write", async () => {
  for (const order of [fixture(), fixture({ closed: false, orderStatus: "Closed" })]) {
    await withMcleod(order, async () => {
      const { POST } = load("app/api/warehouse/domestic-queue/route.ts");
      const response = await POST({ json: async () => ({ terminal: "HOU", siteCode: "5300", movementDirection: "pickup",
        materialType: "lumber", orderId: "0824528", referenceNumber: "2168418" }) });
      assert.equal(response.status, 409);
      assert.ok((await response.json()).completion);
    });
  }
});

test("linking a saved domestic row cannot attach a completed order", async () => {
  await withMcleod(fixture(), async () => {
    const query = { select() { return this; }, eq() { return this; }, in() { return this; },
      async single() { return { data: { updated_at: "revision", reference_number: "2168418", movement_direction: "pickup" } }; } };
    const { PATCH } = load("app/api/warehouse/domestic-queue/route.ts", {
      "@supabase/supabase-js": { createClient: () => ({ from: () => query }) },
    });
    const response = await PATCH({ json: async () => ({ action: "match_order", id: "12345678-1234-4234-8234-123456789012",
      terminal: "HOU", siteCode: "5300", expectedUpdatedAt: "revision", orderId: "0824528" }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).completion.kind, "pickup");
  });
});

test("driver reference and direct-ID lookups show the company; submit rejects completed order", async () => {
  await withMcleod(fixture(), async () => {
    const gate = { terminal: "HOU", site_code: "5300", site_name: "Houston 5300", latitude: 1, longitude: 1 };
    const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: gate }; } };
    const { POST } = load("app/api/gate/check-in/[token]/route.ts", {
      "@supabase/supabase-js": { createClient: () => ({ from: () => query }) },
    });
    const context = { params: Promise.resolve({ token: "12345678-1234-4234-8234-123456789012" }) };
    for (const action of ["lookupReference", "lookupOrder", "submit"]) {
      const req = new Request("https://scm.test/", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId: "0824528", referenceNumber: "2168418", movementDirection: "pickup",
          clientId: "12345678-1234-4234-8234-123456789012", checkinType: "domestic", materialType: "lumber",
          driverName: "Test Driver", driverPhone: "5551234567", truckingCompany: "Test Trucking" }) });
      const response = await POST(req, context);
      const body = await response.json();
      assert.equal(response.status, action === "lookupReference" ? 200 : 409, JSON.stringify(body));
      const completion = action === "lookupReference" ? body.matches[0].completion : body.completion;
      assert.equal(completion.carrierName, "Delivered It Trucking");
      assert.equal(completion.kind, "pickup");
    }
  });
});

test("cotton verification rejects a Closed status without a departure", async () => {
  await withMcleod(fixture({ cotton: true, closed: false, orderStatus: "Closed" }), async () => {
    const { verifyCottonOrder } = load("lib/inbound/checkin/verify-cotton-order.ts");
    await assert.rejects(verifyCottonOrder("0824528", "TESTMARK", 88, true), /closed out/);
  });
});

test("completion notice escapes McLeod strings and shows fallback when time or carrier is missing", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const Notice = load("components/warehouse/CompletedOrderNotice.tsx").default;
  const markup = renderToStaticMarkup(React.createElement(Notice, { orderId: "<script>bad</script>", completion: {
    kind: "closed", message: "Order already closed out in McLeod", completedAt: "", location: "",
    carrierName: "", carrierCode: "",
  } }));
  assert.ok(!markup.includes("<script>"));
  assert.match(markup, /Trucking company unavailable/);
  assert.match(markup, /Completion time unavailable/);
  assert.ok(!markup.includes("<button"));
});
