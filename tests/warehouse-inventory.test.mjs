import test from "node:test";
import assert from "node:assert/strict";
import {
  availableBales,
  normalizeInventoryUpdate,
  safeInventorySearch,
} from "../lib/warehouse/inventory.ts";

test("inventory updates normalize warehouse and booking identifiers", () => {
  assert.deepEqual(normalizeInventoryUpdate({
    currentBales: 88,
    allocatedBales: 44,
    missingBales: 2,
    warehouseLocation: " f2 ",
    bookingNumber: " atl123 ",
    inventoryStatus: "active",
    notes: " Review count ",
  }), {
    currentBales: 88,
    allocatedBales: 44,
    missingBales: 2,
    warehouseLocation: "F2",
    bookingNumber: "ATL123",
    inventoryStatus: "active",
    notes: "Review count",
  });
});

test("inventory never allocates more bales than physically current", () => {
  assert.throws(() => normalizeInventoryUpdate({
    currentBales: 10,
    allocatedBales: 11,
    missingBales: 0,
    inventoryStatus: "active",
  }), /cannot exceed current/);
});

test("available inventory and search filters stay safe", () => {
  assert.equal(availableBales(88, 12), 76);
  assert.equal(availableBales(5, 10), 0);
  assert.equal(safeInventorySearch("  MARK%,(A)_  "), "MARK A");
});
