import test from "node:test";
import assert from "node:assert/strict";
import { dallasFuelCode, planDallasFuelCorrection } from "../lib/dray/dallas-fuel.ts";
import { approvalCharges } from "../lib/dray/approval-charges.ts";

test("plans correction for the existing FSC line without changing its amount", () => {
  const fuel = { id: "FUEL1", charge_id: "FSC", amount: "35.00", rate: "35", units: 1 };
  assert.deepEqual(planDallasFuelCorrection({ status: "A", order_type_id: "FSC" }, [fuel]), { types: true, fuel, issues: [] });
  assert.equal(dallasFuelCode, "FSCD");
});

test("preserves existing FSCD and does not create missing fuel on all-in orders", () => {
  for (const charges of [[], [{ id: "FUEL1", charge_id: "FSCD", amount: 35 }]])
    assert.deepEqual(planDallasFuelCorrection({ status: "A", order_type_id: "FSCD" }, charges), { types: false, fuel: null, issues: [] });
});

test("blocks multiple fuel lines and unavailable orders", () => {
  const fuel = { id: "FUEL1", charge_id: "FSC", amount: 35 };
  assert.ok(planDallasFuelCorrection({ status: "A" }, [fuel, { ...fuel, charge_id: "FSCD" }]).issues.length);
  assert.ok(planDallasFuelCorrection({ status: "D" }, [fuel]).issues.length);
});

test("FSCD counts as negotiated fuel even without a description", () => {
  const result = approvalCharges(535, [{ code: "FSCD", description: "", amount: 35 }],
    { fuelMode: "base_plus_fsc", includedChassisDays: 0, chassisDailyRate: 0 });
  assert.equal(result.billedFsc, 35);
  assert.equal(result.extraTotal, 0);
});
