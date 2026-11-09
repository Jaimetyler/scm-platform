import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("lib/cotton-import/location-resolution.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { resolveCottonLocation } = mod.exports;

const locations = [
  { id: "a", mcleod_code: "NEW-A", prev_code: "OLD-A", name: "Warehouse A", timezone: "America/Chicago", active: true },
  { id: "b", mcleod_code: "NEW-B", prev_code: "OLD-B", name: "Warehouse B", timezone: "America/New_York", active: true },
];
test("current and previous codes resolve to the same approved location", () => {
  assert.equal(resolveCottonLocation(" new-a ", locations).id, "a");
  assert.equal(resolveCottonLocation("old-a", locations).id, "a");
});
test("current code takes precedence over previous-code aliases", () => {
  assert.equal(resolveCottonLocation("NEW-A", [...locations, { ...locations[1], id: "c", prev_code: "NEW-A" }]).id, "a");
});
test("unknown, ambiguous and inactive locations block creation", () => {
  assert.throws(() => resolveCottonLocation("missing", locations), /Unknown/);
  assert.throws(() => resolveCottonLocation("OLD-A", [...locations, { ...locations[1], id: "c", prev_code: "OLD-A" }]), /Ambiguous/);
  assert.throws(() => resolveCottonLocation("OLD-A", [{ ...locations[0], active: false }]), /Inactive/);
  assert.equal(resolveCottonLocation("NEW-A", [{ ...locations[0], timezone: null }]).id, "a");
});
