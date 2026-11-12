import test from "node:test";
import assert from "node:assert/strict";
import { carrierPlanLines, parseQuantities, parseRates } from "../lib/warehouse/outbound/carrier-rates.ts";

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
