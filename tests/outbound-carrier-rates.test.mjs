import test from "node:test";
import assert from "node:assert/strict";
import { carrierBatchSelection, carrierPlanLines, parseQuantities, parseRates } from "../lib/warehouse/outbound/carrier-rates.ts";

test("carrier pay overrides affect only base pay and chassis splits use CS on both sides", () => {
  const rates = parseRates({
    base: { pay: "100", bill: "150" },
    chassisDays: { pay: "20", bill: "40" },
    chassisSplits: { pay: "35", bill: "55" },
    stopoffs: { pay: "25", bill: "50" },
  });
  const quantities = parseQuantities({ chassisDays: "2", chassisSplits: "1", stopoffs: "0" });
  const lines = carrierPlanLines({ rate: { rates }, quantities, basePayOverride: 9000 });
  assert.deepEqual(lines.map(({ payTotal, billTotal, payCode, billCode }) => [payTotal, billTotal, payCode, billCode]), [
    [9000, 15000, null, null],
    [4000, 8000, null, null],
    [3500, 5500, "CS", "CS"],
  ]);
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
  assert.deepEqual(carrierBatchSelection(plan, { charge: "chassisDays", units: 3 }), {
    rateId: "a", rateVersion: "v1",
    quantities: { chassisDays: "4", chassisSplits: "2", stopoffs: "0" }, basePayOverride: "99.00",
  });
  assert.throws(() => carrierBatchSelection(null, { charge: "chassisDays", units: 1 }), /Assign a carrier/);
  assert.throws(() => carrierBatchSelection(plan, { charge: "chassisDays", units: 999 }), /999/);
  assert.throws(() => carrierBatchSelection(plan, { charge: "chassisSplits", units: 1.5 }), /whole number/);
});
