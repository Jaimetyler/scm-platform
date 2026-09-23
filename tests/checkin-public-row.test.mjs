import assert from "node:assert/strict";
import test from "node:test";
import { publicCheckinRow } from "../lib/inbound/checkin/public-row.ts";

test("normal grid responses keep the QR marker but omit private driver evidence", () => {
  const row = publicCheckinRow({
    id: "row-1",
    checkin_source: "driver_qr",
    driver_name: "DRIVER",
    trucking_company: "CARRIER",
    driver_phone: "555-1234",
    driver_latitude: 29.75,
    driver_longitude: -94.98,
    driver_accuracy_m: 12,
    driver_distance_m: 43,
    driver_checkin_site_id: "gate-1",
    gate_location_verified_at: "2026-09-23T15:00:00Z",
  });

  assert.equal(row.checkin_source, "driver_qr");
  assert.equal(row.driver_name, "DRIVER");
  assert.equal(row.trucking_company, "CARRIER");
  assert.equal(row.gate_location_verified_at, "2026-09-23T15:00:00Z");
  for (const key of ["driver_phone", "driver_latitude", "driver_longitude", "driver_accuracy_m", "driver_distance_m", "driver_checkin_site_id"]) {
    assert.equal(Object.hasOwn(row, key), false, key);
  }
});
