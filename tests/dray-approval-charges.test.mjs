import test from "node:test";
import assert from "node:assert/strict";
import { approvalCharges, compareApprovalOrders, defaultApprovalSelection } from "../lib/dray/approval-charges.ts";

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
test('customers without negotiated allowances retain FSC and chassis in full for review', () => {
 const result = approvalCharges(190, [line('Fuel surcharge',45),line('Chassis',45)],null,false);
 assert.equal(result.includedChassis,0);
 assert.equal(result.allIn,100);
 assert.equal(result.extraTotal,90);
 assert.equal(result.extras.length,2);
});

test('only complete positive extras are preselected, deduplicated per order; unconfigured rates require review', () => {
 const orders = [
  {id:'standard',total:295,charges:[line('Chassis',45)]},
  {id:'extra',total:340,charges:[line('Chassis',90)]},
  {id:'extra',total:340,charges:[line('Chassis',90)]},
  {id:'incomplete',total:400,charges:[line('Chassis',null)]},
  {id:'credit',total:240,charges:[line('Credit',-10)]},
 ];
 assert.deepEqual([...defaultApprovalSelection(orders,rate,true)],['extra']);
 assert.deepEqual([...defaultApprovalSelection(orders,null,false)],[]);
});

test("configured all-in base flags separately billed fuel and respects billed chassis days", () => {
 const allIn = { includedChassisDays: 1, chassisDailyRate: 45, fuelMode: "all_in", baseRate: 545 };
 const result = approvalCharges(615, [{...line("Chassis", 40), units: 2}, line("Fuel surcharge", 30)], allIn);
 assert.equal(result.baseVariance, 0);
 assert.equal(result.standardTotal, 565);
 assert.deepEqual(result.extras.map(charge => charge.amount), [20, 30]);
 const separateFuel = approvalCharges(630, [line("Fuel surcharge", 60)], { ...allIn, fuelMode: "base_plus_fsc" });
 assert.equal(separateFuel.baseVariance, 25);
 assert.equal(separateFuel.extraTotal, 0);
});

test("changing billed FSC by week leaves a matching contract base unchanged", () => {
 const rate = { includedChassisDays: 0, chassisDailyRate: 0, fuelMode: "base_plus_fsc", baseRate: 500 };
 for (const fuel of [0, 45.5, 68]) {
   const result = approvalCharges(500 + fuel, [line("Fuel surcharge", fuel)], rate);
   assert.equal(result.baseVariance, 0);
   assert.equal(result.billedFsc, fuel);
 }
});

test("missing minimum chassis is flagged and split charges stay in extras", () => {
 const result = approvalCharges(545, [{code:"CS", description:"Chassis split", amount:45}], rate);
 assert.equal(result.chassisMinimumShortfall, 45);
 assert.equal(result.extraTotal, 45);
});
