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
    name => name in overrides ? overrides[name] : require(name), module, module.exports,
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
