import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as rates from "../lib/dray/service-rates.ts";

const require = createRequire(import.meta.url);
const rule = {
  terminal: "DAL", site_code: "2119", customer_code: "OLAMRITX", revenue_code: "DDRAY", service_type: "drayage",
  fuel_mode: "all_in", base_rate: 545, included_chassis_days: 2, chassis_daily_rate: 35, active: true,
};
test("rates preserve the entered fuel and chassis terms and normalize the yard code", () => {
  assert.deepEqual(rates.normalizeServiceRate(rule), { ...rule, site_code: "SCMDDETX", notes: null });
  assert.throws(() => rates.normalizeServiceRate({ ...rule, terminal: "HOU" }), /warehouse/);
  assert.throws(() => rates.normalizeServiceRate({ ...rule, chassis_daily_rate: 0 }), /positive/);
  assert.equal(rates.normalizeServiceRate({ ...rule, base_rate: "" }).base_rate, null);
});

test("rates import normalizes CSV rows and saves the complete batch by scope", async () => {
  const writes = [];
  const route = ts.transpileModule(readFileSync("app/api/warehouse/rates/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const load = name => ({
    "@/lib/auth/guard": { withStaffAccess: fn => fn },
    "@/lib/auth/session": { staffDatabase: () => ({ from: () => ({ upsert: async (rows, options) => { writes.push({ rows, options }); return {}; } }) }) },
    "@/lib/dray/service-rates": rates,
  })[name] ?? require(name);
  new Function("require", "module", "exports", route)(load, mod, mod.exports);
  const file = new FormData();
  file.set("file", new File([rates.rateColumns.join(",") + "\n" + rates.rateColumns.map(column => rule[column] ?? "").join(",")], "rates.csv"));
  const request = body => new Request("https://test.invalid/api/warehouse/rates", { method: "POST", ...body });
  const response = await mod.exports.POST(request({ body: file }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(writes[0], { rows: [rates.normalizeServiceRate(rule)], options: {
    onConflict: "terminal,site_code,customer_code,revenue_code,service_type",
  } });
  const duplicate = await mod.exports.POST(request({ body: JSON.stringify({ rates: [rule, rule] }) }));
  assert.equal(duplicate.status, 400);
  assert.equal(writes.length, 1);
});
