import assert from "node:assert/strict";
import test from "node:test";
import { lookupMcleodOrderById, lookupMcleodGateOrder } from "../lib/inbound/checkin/mcleod-order-id.ts";

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

test("driver order detects the SCM stop and selects the corresponding reference", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.MCLEOD_BASE_URL;
  const previousToken = process.env.MCLEOD_AUTH_TOKEN;
  process.env.MCLEOD_BASE_URL = "https://mcleod.example";
  process.env.MCLEOD_AUTH_TOKEN = "test";
  let stops = [];
  globalThis.fetch = async () => new Response(JSON.stringify({
    blnum: "PICKUP-123", consignee_refno: "DELIVERY-456", customer_id: "CUSTOMER1", commodity_id: "LUMBER", stops,
  }), { status: 200 });
  try {
    stops = [{ stop_type: "PU", location: { name: "SCM Houston", city: "Houston" } },
      { stop_type: "SO", location: { name: "Customer warehouse", city: "Dallas" } }];
    assert.deepEqual(await lookupMcleodGateOrder("12345", "HOU", "Houston 5300"), {
      direction: "pickup", reference: "PICKUP-123", customer: "CUSTOMER1", commodity: "LUMBER",
      materialType: "lumber", mark: "DELIVERY-456", baleCount: "",
    });
    stops = [{ stop_type: "PU", location: { name: "Customer warehouse", city: "Dallas" } },
      { stop_type: "SO", location: { name: "Savannah Warehouse", city: "Savannah" } }];
    assert.equal((await lookupMcleodGateOrder("12345", "SAV", "Savannah")).direction, "delivery");
    await assert.rejects(lookupMcleodGateOrder("12345", "HOU", "Houston 5300"), /identify this SCM yard/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.MCLEOD_BASE_URL;
    else process.env.MCLEOD_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.MCLEOD_AUTH_TOKEN;
    else process.env.MCLEOD_AUTH_TOKEN = previousToken;
  }
});

test("cotton order fills the mark and bale count from McLeod", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.MCLEOD_BASE_URL;
  const previousToken = process.env.MCLEOD_AUTH_TOKEN;
  process.env.MCLEOD_BASE_URL = "https://mcleod.example";
  process.env.MCLEOD_AUTH_TOKEN = "test";
  globalThis.fetch = async () => new Response(JSON.stringify({
    blnum: "D0975 88 BALES", consignee_refno: "D0975", commodity_id: "COTTON", customer_id: "C1",
    stops: [{ stop_type: "SO", location: { name: "Savannah Warehouse", city: "Savannah" } }],
  }), { status: 200 });
  try {
    const order = await lookupMcleodGateOrder("12345", "SAV", "Savannah");
    assert.equal(order.materialType, "cotton");
    assert.equal(order.reference, "D0975");
    assert.equal(order.mark, "D0975");
    assert.equal(order.baleCount, "88");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.MCLEOD_BASE_URL;
    else process.env.MCLEOD_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.MCLEOD_AUTH_TOKEN;
    else process.env.MCLEOD_AUTH_TOKEN = previousToken;
  }
});
