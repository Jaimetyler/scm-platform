import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { readDallasCustomerCharges } from "../lib/dray/dallas-customer-extras.ts";
import { rememberDallasCharge, sameChargeValues } from "../lib/dray/dallas-billing-receipt.ts";

const initial = { id: "1", code: "DSCM", description: "Chassis", units: 1, rate: 45, amount: 45, inclusion: "N" };
const threeDays = { units: 3, rate: 45, amount: 135 };

function fixture(chassisAmount = 135) {
  const charges = [
    { id: "1", charge_id: "DSCM", units: 3, rate: 45, amount: chassisAmount, incl_in_freight: "N" },
    { id: "2", charge_id: "CS", units: 1, rate: 50, amount: 50, incl_in_freight: "N" },
    { id: "3", charge_id: "FSC", units: 1, rate: 60, amount: 60, incl_in_freight: "N" },
  ];
  const order = { status: "A", rate_type: "F", rate: 500, rate_units: 1, total_charge: 610 + chassisAmount, otherCharges: charges };
  const calls = [];
  const vendor = () => ({
    read: async () => structuredClone(order),
    write: async (path, body) => {
      calls.push(path);
      if (path === "/orders/updateRow") order.total_charge = body.total_charge;
      else Object.assign(charges.find(row => row.id === body.id), body);
    },
    deleteCustomerCharge: async id => {
      calls.push(`delete ${id}`);
      charges.splice(charges.findIndex(row => row.id === id), 1);
    },
  });
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../lib/dray/dallas-billing-restore.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)(name => ({
    "./dallas-customer-extras": { readDallasCustomerCharges },
    "./dallas-billing-receipt": { sameChargeValues },
    "./dallas-linked-order": { readLinkedDallasOrder: read => read("/orders/0830845") },
    "./server": { hash: JSON.stringify, vendor },
  })[name], module, module.exports);
  const receipt = rememberDallasCharge(rememberDallasCharge(undefined, "DSCM", initial, threeDays), "CS", null,
    { units: 1, rate: 50, amount: 50 });
  receipt.charges.find(row => row.code === "CS").chargeId = "2";
  const history = { receipt, async record(next) { this.receipt = next; } };
  return { order, calls, restore: () => module.exports.restoreDallasCustomerCharges("0830845", "BOOKING", {}, history) };
}

test("unassign restores original chassis, removes a platform-added split, and preserves fuel and base", async () => {
  const { order, calls, restore } = fixture();
  await restore();
  assert.deepEqual(calls, ["/other_charge/update", "delete 2", "/orders/updateRow"]);
  assert.equal(order.total_charge, 605);
  assert.equal(order.rate, 500);
  assert.deepEqual(order.otherCharges.map(row => [row.charge_id, row.units, row.amount]), [["DSCM", 1, 45], ["FSC", 1, 60]]);
  await restore();
  assert.equal(calls.length, 3);
});

test("unassign stops before writing when a saved customer charge changed outside the platform", async () => {
  const { calls, restore } = fixture(150);
  await assert.rejects(restore(), /DSCM changed/);
  assert.deepEqual(calls, []);
});

test("a later successful sync keeps the original chassis baseline", () => {
  const first = rememberDallasCharge(undefined, "DSCM", initial, threeDays);
  const second = rememberDallasCharge(first, "DSCM", { ...initial, ...threeDays }, { units: 4, rate: 45, amount: 180 });
  assert.equal(second.charges[0].original.values.amount, 45);
});
