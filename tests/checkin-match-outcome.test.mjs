import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedCustomerId, isOutsideCarrierNoMatch } from "../lib/inbound/checkin/match-outcome.ts";

test("compare the mapped McLeod customer ID rather than the grid alias", () => {
  assert.equal(expectedCustomerId({ resolvedCustomer: { customerId: "BACOMCTX" } }, "BACO"), "BACOMCTX");
});

test("only a completed no-match search becomes an outside carrier", () => {
  assert.equal(isOutsideCarrierNoMatch({ status: "No Match", matchedOrderId: null,
    reason: "No matches found anywhere for mark DF917" }), true);
  assert.equal(isOutsideCarrierNoMatch({ status: "Possible Match", matchedOrderId: "123",
    reason: "Match found under different customer" }), false);
  assert.equal(isOutsideCarrierNoMatch({ status: "No Match", matchedOrderId: null,
    reason: "Missing mark" }), false);
});
