import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSearchOrders } from "../lib/mcleod/inbound/search-response.ts";

test("McLeod order search accepts the wrappers used elsewhere in this repo", () => {
  const order = { id: "12345", customer_id: "BUNGOMNE" };
  for (const response of [[order], { items: [order] }, { results: [order] },
    { orders: [order] }, { rows: [order] }, { data: { orders: [order] } }]) {
    assert.deepEqual(extractSearchOrders(response), [order]);
  }
  assert.deepEqual(extractSearchOrders({ orders: [] }), []);
});

test("unfamiliar and empty responses cannot be counted as no orders", () => {
  assert.equal(extractSearchOrders(null), null);
  assert.equal(extractSearchOrders({ message: "unexpected" }), null);
});
