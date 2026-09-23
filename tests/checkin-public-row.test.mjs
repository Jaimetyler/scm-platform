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
    movement_direction: "pickup",
    material_type: "lumber",
    reference_number: "PO-123",
    destination: "DALLAS, TX",
    bol_photo_path: "HOU/5300/row-1.jpg",
    bol_photo_original_name: "bol.jpg",
    bol_photo_content_type: "image/jpeg",
  });

  assert.equal(row.checkin_source, "driver_qr");
  assert.equal(row.gate_location_verified_at, "2026-09-23T15:00:00Z");
  assert.equal(row.movement_direction, "pickup");
  assert.equal(row.material_type, "lumber");
  assert.equal(row.reference_number, "PO-123");
  assert.equal(row.destination, "DALLAS, TX");
  assert.equal(row.has_bol_photo, true);
  for (const key of ["driver_name", "driver_phone", "trucking_company", "driver_latitude", "driver_longitude", "driver_accuracy_m", "driver_distance_m", "driver_checkin_site_id", "bol_photo_path", "bol_photo_original_name", "bol_photo_content_type"]) {
    assert.equal(Object.hasOwn(row, key), false, key);
  }
});

test("grid responses clearly report when no BOL photo exists", () => {
  assert.equal(publicCheckinRow({ id: "row-2", bol_photo_path: null }).has_bol_photo, false);
});
