import test from "node:test";
import assert from "node:assert/strict";
import { planOutboundDrayLoads } from "../lib/dray/outbound-load-plan.ts";

test("builds stable load references from Book ID and container count", () => {
  const loads = planOutboundDrayLoads(" 5656 ", 2, "SCMDDETX", "BNSFHATX");
  assert.deepEqual(loads.map(load => load.originalBlnum), ["5656-1", "5656-2"]);
  assert.equal(loads[0].pickup, "SCMDDETX");
  assert.throws(() => planOutboundDrayLoads("", 2, "SCMDDETX", "BNSFHATX"), /Book ID/);
  assert.throws(() => planOutboundDrayLoads("5656", 0, "SCMDDETX", "BNSFHATX"), /container count/);
  assert.throws(() => planOutboundDrayLoads("5656", 2, null, "BNSFHATX"), /pickup warehouse/);
});
