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

test("McLeod's top-level JSON null is a valid empty search result", () => {
  assert.deepEqual(extractSearchOrders(null), []);
});

test("unknown shapes still fail instead of being counted as no orders", () => {
  for (const payload of [undefined, "", false, {}, { data: null }, { orders: null },
    { message: "unexpected" }, { error: "Access denied" }]) {
    assert.equal(extractSearchOrders(payload), null);
  }
});
