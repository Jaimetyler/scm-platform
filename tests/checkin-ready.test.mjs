import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPostDeliveryCorrection, isReadyCheckin, usesMcleodCheckin } from "../lib/inbound/checkin/ready.ts";

const complete = {
  terminal: "SAV", site_code: "MAIN", site_name: "Savannah",
  sub_location: "MAIN", received_date: "2026-09-22", mark: "TEST",
  shipper: "CUSTOMER", bol_bc: 123, bale_count: 20,
  warehouse_location: "A-12", equipment_type: "V", verified: false,
};

test("a complete row is ready without a manual verification checkbox", () => {
  assert.equal(isReadyCheckin(complete), true);
});

test("a row never processes before its location or another required field is complete", () => {
  for (const field of Object.keys(complete).filter((key) => key !== "verified")) {
    assert.equal(isReadyCheckin({ ...complete, [field]: null }), false, field);
  }
  assert.equal(isReadyCheckin({ ...complete, warehouse_location: "  " }), false);
});

test("only cotton deliveries can enter the McLeod delivery workflow", () => {
  assert.equal(usesMcleodCheckin({ ...complete, movement_direction: "delivery", material_type: "cotton" }), true);
  for (const row of [
    { ...complete, movement_direction: "pickup", material_type: "cotton" },
    { ...complete, movement_direction: "delivery", material_type: "lumber" },
    { ...complete, movement_direction: "delivery", material_type: "other" },
  ]) {
    assert.equal(usesMcleodCheckin(row), false);
    assert.equal(isReadyCheckin(row), false);
  }
});

test("post-delivery corrections update only check-in details and preserve the McLeod record", () => {
  const existing = { ...complete, comment_1: "Old note", comment_2: null,
    matched_order_id: "8022392", draft_status: "processed",
    checked_in_at: "2026-09-22T14:00:00Z", verified_at: "2026-09-22T15:00:00Z" };
  const corrected = buildPostDeliveryCorrection(existing,
    { ...existing, mark: "FIXED", comment_1: "New note" }, "2026-09-22T16:00:00Z");
  assert.equal(corrected.mark, "FIXED");
  assert.equal(corrected.identity_corrected_at, "2026-09-22T16:00:00Z");
  for (const protectedField of ["matched_order_id", "draft_status", "checked_in_at", "verified_at", "terminal", "site_code"]) {
    assert.equal(Object.hasOwn(corrected, protectedField), false, protectedField);
  }
  assert.throws(() => buildPostDeliveryCorrection(existing,
    { ...existing, mark: "" }, "2026-09-22T16:00:00Z"), /required fields/);
});
