import test from "node:test";
import assert from "node:assert/strict";
import { requestedEquipment, reviewPickupEquipment } from "../lib/cotton-import/equipment.ts";
import { draftHoustonOrder } from "../lib/cotton-import/pilot.ts";

const stop = code => ({ locationId: code, locationCode: code, scheduledDate: "2026-11-10", timezone: "America/Chicago" });

test("Houston defaults to VT at Gulf and Taylor and to van on mixed Moody pickups", () => {
  const flexible = [stop("GULFCOT2"), stop("TAYLTAT1")];
  assert.equal(reviewPickupEquipment(flexible, [], "auto").code, "VT");
  assert.equal(reviewPickupEquipment(flexible, [], "van").choice, "van");
  assert.equal(reviewPickupEquipment(flexible, [], "van").code, "V");
  assert.equal(reviewPickupEquipment(flexible, [], "flatbed").code, "FT");
  assert.equal(reviewPickupEquipment([stop("GULFCOT2"), stop("MOODGAT3")], [], "auto").choice, "van");
  for (const code of ["MOODGAT1", "MOODGAT2", "MOODGAT3", "MOODGAT4"]) {
    for (const option of ["VT", "flatbed"]) {
      const result = reviewPickupEquipment([stop(code)], [], option);
      assert.equal(result.code, null);
      assert.match(result.reason, /Van only/);
    }
  }
});

test("Houston honors effective facility restrictions and flags unknown pickup equipment", () => {
  const restriction = { location_id: "GULFCOT2", accepted_equipment: "van_only", effective_date: "2026-11-01", verified: true };
  assert.match(reviewPickupEquipment([stop("GULFCOT2")], [restriction], "VT").reason, /Van only/);
  assert.equal(reviewPickupEquipment([stop("GULFCOT2")], [{ ...restriction, effective_date: "2026-11-11" }], "VT").code, "VT");
  assert.match(reviewPickupEquipment([stop("UNITELTX")], [], "auto").reason, /Confirm accepted equipment/);
  assert.throws(() => requestedEquipment("invalid"));
});

test("Houston draft sends the validated McLeod equipment code", () => {
  const proposal = { customerId: "BUNGOMNE", revenueCode: "MAIN", commodity: "COTTON", deliveryLocation: "SUPPBAT1",
    blnum: "EH020 90 BALES", pickupStops: [stop("GULFCOT2")] };
  const order = { salesOrder: "2601968", mark: "EH020", bales: 90, pickups: [{ bales: 90 }] };
  const windows = [{ early: "08:00", late: "16:00" }];
  for (const code of ["V", "VT", "FT"]) {
    assert.equal(draftHoustonOrder(order, proposal, windows, code).order.equipment_type_id, code);
  }
  const united = stop("UNITELTX");
  const policy = { location_id: united.locationId, accepted_equipment: "van_only", effective_date: null, verified: true };
  const equipment = reviewPickupEquipment([united], [policy], "auto");
  assert.equal(draftHoustonOrder({ ...order, salesOrder: "2601730" }, { ...proposal, pickupStops: [united] }, windows, equipment.code).order.equipment_type_id, "V");
});
