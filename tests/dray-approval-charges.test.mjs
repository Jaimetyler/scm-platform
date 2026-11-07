import test from "node:test";
import assert from "node:assert/strict";
import { approvalCharges } from "../lib/dray/approval-charges.ts";

test("negotiated FSC stays in all-in drayage and is excluded from approval extras", () => {
 const charges = [
  {code: "FSC", description: "Fuel", amount: 30},
  {code: "123", description: "Fuel surcharge", amount: 10},
  {code: "CHAS", description: "Chassis", amount: 45.25},
  {code: "STOP", description: "Extra stop", amount: 50},
 ];
 assert.deepEqual(approvalCharges(335.25, charges), {allIn: 240, extras: charges.slice(2)});
 assert.equal(approvalCharges(100, []).allIn, 100);
});
test("missing financial data does not become a confirmed all-in rate", () => {
 assert.equal(approvalCharges(100, null).allIn, null);
 assert.equal(approvalCharges(null, []).allIn, null);
 assert.equal(approvalCharges(100, [{code: "FSC", description: "Fuel", amount: null}]).allIn, null);
});
