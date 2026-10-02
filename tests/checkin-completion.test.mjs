import assert from "node:assert/strict";
import test from "node:test";
import { describeMcleodCompletion, lookupMcleodGateOrder } from "../lib/inbound/checkin/mcleod-order-id.ts";

test("a finished pickup stays distinct from delivery of the whole order", async () => {
  const result = await describeMcleodCompletion({ __statusDescr: "Available", movements: [
    { id: "M1", carrier: { name: "Pickup Trucking" } },
  ] }, { stop_type: "PU", actual_departure: "20261001090000-0400", movement_id: "M1",
    location: { name: "SCM 1601", address1: "1601 Old Augusta Rd S" } }, "pickup");
  assert.equal(result.kind, "pickup");
  assert.equal(result.message, "Pickup already completed in McLeod");
  assert.equal(result.carrierName, "Pickup Trucking");
  assert.equal(result.completedAt, "20261001090000-0400");
  assert.match(result.location, /1601 Old Augusta/);
});

test("completed delivery uses its historical movement, not the current carrier", async () => {
  const result = await describeMcleodCompletion({ curr_movement_id: "NEW", movements: [
    { id: "NEW", carrier: { name: "Later Carrier" } },
    { id: "OLD", vendor: { name: "Delivered It Trucking" } },
  ] }, { movement_id: "OLD", actual_departure: "20260930103000-0500" }, "delivery");
  assert.equal(result.kind, "delivery");
  assert.equal(result.carrierName, "Delivered It Trucking");
});

test("ambiguous or missing movement linkage never invents the delivering company", async () => {
  for (const stop of [{ actual_departure: "20261001090000-0400" },
    { movement_id: "MISSING", actual_departure: "20261001090000-0400" }]) {
    const result = await describeMcleodCompletion({ curr_movement_id: "NEW", carrier_name: "Order Carrier",
      movements: [{ id: "OLD", carrier_name: "Old" }, { id: "NEW", carrier_name: "New" }] }, stop, "delivery");
    assert.equal(result.carrierName, "");
    assert.equal(result.carrierCode, "");
  }
});

test("nested movement stops can identify the company for a completed stop", async () => {
  const result = await describeMcleodCompletion({ movements: [
    { id: "M1", stops: [{ id: "S1" }], carrier_name: "Correct Carrier" },
    { id: "M2", stops: [{ id: "S2" }], carrier_name: "Other Carrier" },
  ] }, { id: "S1", actual_departure: "20261001090000-0400" }, "delivery");
  assert.equal(result.carrierName, "Correct Carrier");
});

test("status-only closure is blocked without inventing a departure timestamp", async () => {
  const result = await describeMcleodCompletion({ __statusDescr: "Delivered" }, {}, "pickup");
  assert.equal(result.kind, "closed");
  assert.equal(result.completedAt, "");
  assert.equal(result.message, "Order already closed out in McLeod");
  const cancelled = await describeMcleodCompletion({ __statusDescr: "Cancelled" }, {}, "delivery");
  assert.equal(cancelled.kind, "cancelled");
});

test("available, dispatched, and negated descriptions are not completed", async () => {
  for (const status of ["Available", "In Progress", "Not Delivered", "Partially Delivered", ""]) {
    assert.equal(await describeMcleodCompletion({ __statusDescr: status }, {}, "delivery"), null);
  }
});

test("carrier lookup failure leaves the completed result and carrier code visible", async () => {
  const originalFetch = globalThis.fetch;
  const oldBase = process.env.MCLEOD_BASE_URL, oldToken = process.env.MCLEOD_AUTH_TOKEN;
  process.env.MCLEOD_BASE_URL = "https://mcleod.example";
  process.env.MCLEOD_AUTH_TOKEN = "test";
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(url); throw new Error("Unavailable"); };
  try {
    const result = await describeMcleodCompletion({ movements: [{ id: "M1", carrier_id: "C1" }] },
      { actual_departure: "20261001090000-0400" }, "delivery");
    assert.equal(result.carrierName, "");
    assert.equal(result.carrierCode, "C1");
    assert.equal(result.kind, "delivery");
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldBase === undefined) delete process.env.MCLEOD_BASE_URL; else process.env.MCLEOD_BASE_URL = oldBase;
    if (oldToken === undefined) delete process.env.MCLEOD_AUTH_TOKEN; else process.env.MCLEOD_AUTH_TOKEN = oldToken;
  }
});

test("yard lookup returns a closed result even when the scheduled date is old", async () => {
  const originalFetch = globalThis.fetch;
  const oldBase = process.env.MCLEOD_BASE_URL, oldToken = process.env.MCLEOD_AUTH_TOKEN;
  process.env.MCLEOD_BASE_URL = "https://mcleod.example";
  process.env.MCLEOD_AUTH_TOKEN = "test";
  globalThis.fetch = async () => Response.json({ revenue_code_id: "MAIN", customer_id: "C1",
    blnum: "2168418 / 1479334", commodity_id: "LUMBER", movements: [{ carrier_name: "Historical Carrier" }],
    stops: [{ id: "PU", stop_type: "PU", actual_departure: "20260101090000-0500",
      sched_arrive_early: "20260101070000-0500", location: { name: "Supply Chain Management", address1: "1601 Old Augusta Rd S" } }] });
  try {
    const order = await lookupMcleodGateOrder("0824528", "SAV", "Savannah 1601");
    assert.equal(order.completion.kind, "pickup");
    assert.equal(order.completion.carrierName, "Historical Carrier");
    assert.equal(order.reference, "2168418 / 1479334");
    await assert.rejects(lookupMcleodGateOrder("0824528", "SAV", "Savannah 246"), /identify this SCM yard/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldBase === undefined) delete process.env.MCLEOD_BASE_URL; else process.env.MCLEOD_BASE_URL = oldBase;
    if (oldToken === undefined) delete process.env.MCLEOD_AUTH_TOKEN; else process.env.MCLEOD_AUTH_TOKEN = oldToken;
  }
});
