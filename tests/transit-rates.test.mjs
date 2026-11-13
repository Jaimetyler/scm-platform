import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTransitRate } from "../lib/dray/transit-rates.ts";

test("transit rates normalize a city/state route and retain integer cents", () => {
  const row = { account_code: " olamritx ", pickup_city: " Corpus   Christi ", pickup_state: "tx", delivery_code: "suppbat1", flat_rate: "$850.25" };
  assert.deepEqual(normalizeTransitRate(row), { account_code: "OLAMRITX", account_name: "", pickup_city: "CORPUS CHRISTI",
    pickup_state: "TX", delivery_code: "SUPPBAT1", flat_cents: 85025 });
  assert.throws(() => normalizeTransitRate({ ...row, delivery_code: "unknown" }), /delivery code/);
  assert.throws(() => normalizeTransitRate({ ...row, flat_rate: "" }), /dollar amount/);
});
