import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as rates from "../lib/dray/service-rates.ts";

const require = createRequire(import.meta.url);
const rule = {
  terminal: "DAL", site_code: "2119", return_location: "DIT", customer_code: "OLAMRITX", revenue_code: "DDRAY", service_type: "drayage",
  fuel_mode: "all_in", base_rate: 545, included_chassis_days: 2, chassis_daily_rate: 35, active: true,
};
test("rates preserve the entered fuel and chassis terms and normalize the yard code", () => {
  assert.deepEqual(rates.normalizeServiceRate(rule), { ...rule, site_code: "SCMDDETX", return_location: "UNIOWITX", chassis_split_rate: null, stopoff_rate: null, notes: null });
  assert.equal(rates.normalizeServiceRate({ ...rule, chassis_split_rate: "25.50", stopoff_rate: "0" }).chassis_split_rate, 25.5);
  assert.equal(rates.normalizeServiceRate({ ...rule, stopoff_rate: "0" }).stopoff_rate, 0);
  assert.throws(() => rates.normalizeServiceRate({ ...rule, stopoff_rate: -1 }), /stopoff rate/);
  assert.throws(() => rates.normalizeServiceRate({ ...rule, terminal: "HOU" }), /warehouse/);
  assert.throws(() => rates.normalizeServiceRate({ ...rule, chassis_daily_rate: 0 }), /positive/);
  assert.throws(() => rates.normalizeServiceRate({ ...rule, base_rate: "" }), /base rate/);
  assert.equal(rates.normalizeServiceRate({ ...rule, fuel_mode: "FSC" }).fuel_mode, "base_plus_fsc");
  assert.equal(rates.normalizeServiceRate({ ...rule, fuel_mode: "FLAT" }).fuel_mode, "fuel_for_review");
  assert.equal(rates.normalizeServiceRate({ ...rule, fuel_mode: "All in" }).fuel_mode, "all_in");
});

test("rates import normalizes CSV rows and saves the complete batch by scope", async () => {
  const writes = [];
  const route = ts.transpileModule(readFileSync("app/api/warehouse/rates/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const load = name => ({
    "@/lib/auth/guard": { withStaffAccess: fn => fn },
    "@/lib/auth/session": { staffDatabase: () => ({ from: () => ({ update: row => ({
      eq: (field, code) => ({ select: () => ({ maybeSingle: async () => {
        writes.push({ row, field, code }); return { data: { rate_code: code } };
      } }) }),
    }), upsert: async (rows, options) => { writes.push({ rows, options }); return {}; } }) }) },
    "@/lib/dray/service-rates": rates,
  })[name] ?? require(name);
  new Function("require", "module", "exports", route)(load, mod, mod.exports);
  const file = new FormData();
  file.set("file", new File([rates.rateColumns.join(",") + "\n" + rates.rateColumns.map(column => rule[column] ?? "").join(",")], "rates.csv"));
  const request = body => new Request("https://test.invalid/api/warehouse/rates", { method: "POST", ...body });
  const response = await mod.exports.POST(request({ body: file }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(writes[0], { rows: [rates.normalizeServiceRate(rule)], options: {
    onConflict: "terminal,site_code,customer_code,revenue_code,service_type,return_location",
  } });
  const duplicate = await mod.exports.POST(request({ body: JSON.stringify({ rates: [rule, rule] }) }));
  assert.equal(duplicate.status, 400);
  assert.equal(writes.length, 1);
  const changed = { ...rule, site_code: "9280", return_location: "BNSF Haslet" };
  const edit = await mod.exports.POST(request({ body: JSON.stringify({ rateCode: 42, rates: [changed] }) }));
  assert.equal(edit.status, 200);
  assert.deepEqual(writes[1], { row: rates.normalizeServiceRate(changed), field: "rate_code", code: 42 });
});
