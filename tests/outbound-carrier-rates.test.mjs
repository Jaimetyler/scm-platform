import test from "node:test";
import assert from "node:assert/strict";
import { carrierBatchSelection, carrierPlanLines, carrierPlanTotals, parseQuantities, parseRates } from "../lib/warehouse/outbound/carrier-rates.ts";

test("carrier pay overrides affect only base pay and chassis splits use CS on both sides", () => {
  const rates = parseRates({
    base: { pay: "100", bill: "150" },
    chassisDays: { pay: "20", bill: "40" },
    chassisSplits: { pay: "35", bill: "55" },
    stopoffs: { pay: "25", bill: "50" },
  });
  const quantities = parseQuantities({ chassisDays: "2", chassisSplits: "1", stopoffs: "0" });
  const billing = { base: 15000, chassisDays: 4000, chassisSplits: 5500, stopoffs: 5000 };
  assert.deepEqual(rates.base, { pay: 10000 });
  const plan = { rate: { rates }, quantities, basePayOverride: 9000 };
  const lines = carrierPlanLines(plan, billing);
  assert.deepEqual(lines.map(({ payTotal, billTotal, payCode, billCode }) => [payTotal, billTotal, payCode, billCode]), [
    [9000, 15000, null, null],
    [4000, 8000, null, null],
    [3500, 5500, "CS", "CS"],
  ]);
  assert.deepEqual(carrierPlanTotals(plan, billing), { pay: 16500, bill: 28500 });
  assert.deepEqual(carrierPlanTotals(plan, { ...billing, chassisSplits: null }), { pay: 16500, bill: null });
  assert.throws(() => parseQuantities({ ...quantities, chassisDays: "1.5" }), /whole number/);
});

test("batch carrier changes keep charge quantities and use the new carrier's saved prices", () => {
  const oldRate = { id: "old", updated_at: "old-version" };
  const newRate = { id: "new", updated_at: "new-version" };
  const plan = { rate: oldRate, quantities: { chassisDays: 1, chassisSplits: 2, stopoffs: 0 }, basePayOverride: 9900 };
  assert.deepEqual(carrierBatchSelection(plan, { rate: newRate }), {
    rateId: "new", rateVersion: "new-version",
    quantities: { chassisDays: "1", chassisSplits: "2", stopoffs: "0" }, basePayOverride: "",
  });
  assert.equal(carrierBatchSelection(plan, { rate: { ...oldRate, updated_at: "later" } }).rateVersion, "old-version");
});

test("batch charges add units against each row's saved rate and preserve other pricing", () => {
  const plan = { rate: { id: "a", updated_at: "v1" },
    quantities: { chassisDays: 1, chassisSplits: 2, stopoffs: 0 }, basePayOverride: 9900 };
  assert.deepEqual(carrierBatchSelection(plan, { charges: { chassisDays: 3, chassisSplits: 1, stopoffs: 0 } }), {
    rateId: "a", rateVersion: "v1",
    quantities: { chassisDays: "4", chassisSplits: "3", stopoffs: "0" }, basePayOverride: "99.00",
  });
  assert.throws(() => carrierBatchSelection(null, { charges: { chassisDays: 1, chassisSplits: 0, stopoffs: 0 } }), /Assign a carrier/);
  assert.throws(() => carrierBatchSelection(plan, { charges: { chassisDays: 999, chassisSplits: 0, stopoffs: 0 } }), /999/);
  assert.throws(() => carrierBatchSelection(plan, { charges: { chassisDays: 0, chassisSplits: 1.5, stopoffs: 0 } }), /whole number/);
});

test("customer chassis minimum is billed on top of base and never increases carrier pay", () => {
  const rates = parseRates({ base: { pay: "100" }, chassisDays: { pay: "20" }, chassisSplits: { pay: "0" }, stopoffs: { pay: "0" } });
  const billing = { base: 50000, chassisDays: 3500, chassisSplits: null, stopoffs: null, minimumChassisDays: 2 };
  for (const [days, pay, bill] of [[0, 10000, 57000], [1, 12000, 57000], [3, 16000, 60500]]) {
    const plan = { rate: { rates }, quantities: { chassisDays: days, chassisSplits: 0, stopoffs: 0 } };
    assert.deepEqual(carrierPlanTotals(plan, billing), { pay, bill });
  }
});
