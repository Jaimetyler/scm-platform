import assert from "node:assert/strict";
import test from "node:test";
import { lookupMcleodOrderById } from "../lib/inbound/checkin/mcleod-order-id.ts";

test("driver order ID picks BLNUM for pickup and consignee reference for delivery", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.MCLEOD_BASE_URL;
  const previousToken = process.env.MCLEOD_AUTH_TOKEN;
  process.env.MCLEOD_BASE_URL = "https://mcleod.example";
  process.env.MCLEOD_AUTH_TOKEN = "test";
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "12345", blnum: "LOAD 1085745 PICKUP", consignee_refno: "DEL 98765",
    customer_id: "CUSTOMER1",
  }), { status: 200 });
  try {
    const pickup = await lookupMcleodOrderById("12345", "pickup");
    const delivery = await lookupMcleodOrderById("12345", "delivery");
    assert.equal(pickup.reference, "LOAD 1085745 PICKUP");
    assert.equal(delivery.reference, "DEL 98765");
    assert.equal(pickup.customer, "CUSTOMER1");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.MCLEOD_BASE_URL;
    else process.env.MCLEOD_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.MCLEOD_AUTH_TOKEN;
    else process.env.MCLEOD_AUTH_TOKEN = previousToken;
  }
});
