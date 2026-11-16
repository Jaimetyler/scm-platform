import test from "node:test";
import assert from "node:assert/strict";
import { dallasPendingBillExtras, planDallasCustomerExtras, readDallasCustomerCharges } from "../lib/dray/dallas-customer-extras.ts";

const rate = { included_chassis_days: 1, chassis_daily_rate: 35, chassis_split_rate: 60, stopoff_rate: 75 };
const quantities = { chassisDays: 3, chassisSplits: 1, stopoffs: 1 };
const chassis = { id: "CHASSIS1", code: "DSCM", description: "DAL Chassis Charges", units: 1, rate: 35, amount: 35, inclusion: "N" };
const split = { id: "SPLIT1", code: "CS", description: "Existing split", units: 2, rate: 50, amount: 100, inclusion: "N" };

test("extends the current chassis line, adds a missing stopoff, and preserves the existing split", () => {
  const { changes, blockers } = planDallasCustomerExtras(quantities, rate, [chassis, split], false);
  assert.deepEqual(blockers, []);
  assert.deepEqual(changes.map(line => [line.code, line.amount, line.previous?.id]), [
    ["DSCM", 105, "CHASSIS1"], ["006", 75, undefined],
  ]);
  const after = [...changes.map(line => ({ ...line, id: line.previous?.id ?? "NEW", inclusion: "N" })), split];
  assert.deepEqual(planDallasCustomerExtras(quantities, rate, after, false).changes, []);
});

test("does not reduce chassis already billed or send the customer's standard minimum", () => {
  assert.deepEqual(planDallasCustomerExtras({ ...quantities, chassisDays: 1, stopoffs: 0 }, rate, [split], false).changes, []);
  const billed = [{ ...chassis, units: 4, amount: 140 }, split];
  assert.deepEqual(planDallasCustomerExtras({ ...quantities, stopoffs: 0 }, rate, billed, false).changes, []);
});

test("applies the MSC chassis exception and permits a missing stopoff when an existing chassis charge needs review", () => {
  const badChassis = { ...chassis, id: "" };
  const result = planDallasCustomerExtras(quantities, rate, [badChassis, split], false);
  assert.deepEqual(result.changes.map(line => line.code), ["006"]);
  assert.match(result.blockers[0], /DSCM could not/);
  assert.deepEqual(planDallasCustomerExtras(quantities, rate, [badChassis, split], true).blockers, []);
});


test("a missing standard chassis charge is flagged without blocking other missing accessorials", () => {
  const result = planDallasCustomerExtras(quantities, rate, [], false);
  assert.deepEqual(result.changes.map(line => line.code), ["CS", "006"]);
  assert.match(result.blockers[0], /standard DSCM charge is missing/);
});

test("reconciles a missing freight flag and derives missing chassis units before increasing DSCM", () => {
  const billed = readDallasCustomerCharges([{ id: "CHASSIS1", charge_id: "DSCM", amount: "35.00" }], 50000, 53500);
  assert.equal(billed[0].inclusion, "N");
  const result = planDallasCustomerExtras({ ...quantities, chassisSplits: 0, stopoffs: 0 }, rate, billed, false);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.changes[0].previous.units, 1);
  assert.equal(result.changes[0].amount, 105);
  assert.equal(readDallasCustomerCharges([{ charge_id: "DSCM", amount: 35 }], 50000, 52000)[0].inclusion, null);
});

test("the McLeod bill fallback stacks only unposted customer extras", () => {
  const plan = { quantities };
  const billing = { base: null, minimumChassisDays: 1, chassisDays: 3500, chassisSplits: 6000, stopoffs: 7500 };
  assert.equal(dallasPendingBillExtras(plan, billing, [chassis, split]), 145);
  const billed = [{ ...chassis, units: 3, amount: 105 }, split,
    { id: "STOP", code: "006", amount: 75, units: 1, rate: 75, inclusion: "N", description: "Stopoff" }];
  assert.equal(dallasPendingBillExtras(plan, billing, billed), 0);
  assert.equal(dallasPendingBillExtras(plan, billing, [chassis, split], "MSC"), 75);
});
