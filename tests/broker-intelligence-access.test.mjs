import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    name => name in overrides ? overrides[name] : name === "@/lib/auth/session" ? { staffDatabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) } : name === "@/lib/reporting/broker-snapshot" ? load("../lib/reporting/broker-snapshot.ts") : require(name), module, module.exports,
  );
  return module.exports;
}

test("Broker Intelligence requires an administrator even when called outside middleware", async () => {
  for (const role of ["admin", "operator", "viewer", "accounting"]) {
    const page = load("../app/reporting/broker-intelligence/page.tsx", {
      "@/lib/auth/page": { requireStaffPage: async () => ({ role }) },
      "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
      "./brokerage-dashboard": { default: () => null },
    }).default;
    if (role === "admin") assert.ok(await page());
    else await assert.rejects(page, /redirect:\/access-denied/);
  }
});

test("Platform page policy keeps Broker Intelligence out of non-admin access", () => {
  const { canAccessStaffPage } = load("../lib/auth/policy.ts");
  for (const role of ["admin", "operator", "viewer", "accounting"]) {
    assert.equal(canAccessStaffPage({ role, status: "active", terminal: "HOU" }, "/reporting/broker-intelligence"), role === "admin");
  }
});

test("A missing staff session cannot render Broker Intelligence", async () => {
  const page = load("../app/reporting/broker-intelligence/page.tsx", {
    "@/lib/auth/page": { requireStaffPage: async () => { throw new Error("redirect:/login"); } },
    "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "./brokerage-dashboard": { default: () => null },
  }).default;
  await assert.rejects(page, /redirect:\/login/);
});

test("Each page visit reads the shared saved snapshot", async () => {
  const saved = { version: 1, rows: [{ month: "2026-08", code: "MAIN", person: "dispatcher", customer: "customer", name: "Customer", loads: 2, revenue: 10000, pay: 7000, margin: 3000 }] };
  let reads = 0;
  const page = load("../app/reporting/broker-intelligence/page.tsx", {
    "@/lib/auth/page": { requireStaffPage: async () => ({ role: "admin" }) },
    "@/lib/auth/session": { staffDatabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { reads++; return { data: { payload: saved, updated_at: "2026-11-10T15:00:00Z" }, error: null }; } }) }) }) }) },
    "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "./brokerage-dashboard": { default: () => null },
  }).default;
  for (let visit = 0; visit < 2; visit++) {
    const result = await page();
    assert.deepEqual(result.props.initialSnapshot, saved);
  }
  assert.equal(reads, 2);
});

test("Snapshot updates validate before persisting and keep the shared current key", async () => {
  const { NextRequest } = require("next/server");
  const saved = { version: 1, rows: [{ month: "2026-08", code: "MAIN", person: "dispatcher", customer: "customer", name: "Customer", loads: 2, revenue: 10000, pay: 7000, margin: 3000 }] };
  const writes = [];
  const route = load("../app/api/reporting/broker-intelligence/route.ts", {
    "@/lib/auth/guard": { withStaffAccess: handler => handler, staffActor: () => "admin@example.test" },
    "@/lib/auth/session": { staffDatabase: () => ({ from: () => ({ upsert: async value => { writes.push(value); return { error: null }; } }) }) },
  }).POST;
  const request = body => new NextRequest("https://scm.example.test/api/reporting/broker-intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route(request({ snapshot: { version: 1, rows: [] } }))).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await route(request({ snapshot: saved, filename: "updated.json" }))).status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, "current");
  assert.deepEqual(writes[0].payload, saved);
});
