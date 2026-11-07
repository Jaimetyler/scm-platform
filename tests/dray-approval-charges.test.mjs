import test from "node:test";
import assert from "node:assert/strict";
import { approvalCharges, compareApprovalOrders } from "../lib/dray/approval-charges.ts";

test("negotiated FSC stays in all-in drayage and is excluded from approval extras", () => {
 const charges = [
  {code: "FSC", description: "Fuel", amount: 30},
  {code: "123", description: "Fuel surcharge", amount: 10},
  {code: "CHAS", description: "Chassis", amount: 45.25},
  {code: "STOP", description: "Extra stop", amount: 50},
 ];
 const result = approvalCharges(335.25, charges);
 assert.equal(result.allIn, 240);
 assert.deepEqual(result.extras.map(({includedAmount, ...charge}) => charge), charges.slice(2));
 assert.equal(approvalCharges(100, []).allIn, 100);
});
test("missing financial data does not become a confirmed all-in rate", () => {
 assert.equal(approvalCharges(100, null).allIn, null);
 assert.equal(approvalCharges(null, []).allIn, null);
 assert.equal(approvalCharges(100, [{code: "FSC", description: "Fuel", amount: null}]).allIn, null);
});

const rate = { includedChassisDays: 1, chassisDailyRate: 45 };
const line = (description, amount) => ({code: "X", description, amount});
test("one $45 chassis day is standard; only additional chassis and accessorials need approval", () => {
 const result = approvalCharges(390, [line("Fuel surcharge", 30), line("Chassis", 90), line("Detention", 50)], rate);
 assert.equal(result.allIn, 250);
 assert.equal(result.standardTotal, 295);
 assert.equal(result.includedChassis, 45);
 assert.equal(result.extraTotal, 95);
 assert.deepEqual(result.extras.map(c => c.amount), [45, 50]);
});
test("allowance is applied once across split chassis lines and does not invent a charge", () => {
 const result = approvalCharges(340, [line("Chassis", 30), line("Chassis", 60)], rate);
 assert.equal(result.extraTotal, 45);
 assert.equal(result.includedChassis, 45);
 assert.equal(approvalCharges(295, [line("Chassis", 45)], rate).extras.length, 0);
 assert.equal(approvalCharges(250, [], rate).standardTotal, 250);
 assert.equal(approvalCharges(45, [line("Chassis", 45)]).extraTotal, 45);
});
test("incomplete lines require review and preserve known extras", () => {
 const result = approvalCharges(400, [line("Chassis", null), line("Detention", 50)], rate);
 assert.equal(result.extraTotal, null);
 assert.equal(result.standardTotal, null);
 assert.equal(result.extras.length, 2);
});
test("extras sort before standard loads, then by highest order total", () => {
 const rows = [{id: 1, total: 500, extraTotal: 0}, {id: 2, total: 350, extraTotal: 55}, {id: 3, total: 400, extraTotal: 80}];
 assert.deepEqual(rows.sort(compareApprovalOrders).map(r => r.id), [3, 2, 1]);
});
