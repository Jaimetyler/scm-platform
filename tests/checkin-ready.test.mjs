import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadyCheckin } from "../lib/inbound/checkin/ready.ts";

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
