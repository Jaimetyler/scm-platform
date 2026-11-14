import test from "node:test";
import assert from "node:assert/strict";
import { buildBookingSyncPreview } from "../lib/warehouse/outbound/booking-sync-preview.ts";

const load = { id: "one", sequence: 1, mark: "MK1", container: "ABCD1234567", plan: null };
const order = { id: "00123", blnum: "5656-1", consignee_refno: "ABCD1234567",
  curr_movement_id: "movement", movements: [{
    id: "movement", override_pay_amt: "300.00", otherCarrierPay: [
      { id: "1", charge_id: "001", descr: "SOC Return", amount: "45.00" },
      { id: "2", charge_id: "001", descr: "SOC Return", amount: "25.00" },
    ],
  }],
};

test("uses saved SCM number even when the container changed and preserves duplicate pay codes", () => {
  const preview = buildBookingSyncPreview([{ ...load, container: "WXYZ1234567", savedOrderId: order.id }], [order], "5656", null);
  assert.equal(preview.rows[0].order.basePay, 300);
  assert.deepEqual(preview.rows[0].order.otherPay.map(row => [row.id, row.code, row.amount]),
    [["1", "001", 45], ["2", "001", 25]]);
  assert.equal(preview.unmatchedOrders.length, 0);
});

test("flags competing matches and keeps unreturned pay distinct from an empty list", () => {
  const alternate = { id: "00234", blnum: "5656-2", consignee_refno: load.container };
  const preview = buildBookingSyncPreview([load], [order, alternate], "5656", null);
  assert.equal(preview.rows[0].issue, "Ambiguous order match");
  assert.equal(preview.unmatchedOrders[1].otherPay, null);
  const empty = buildBookingSyncPreview([load], [{ ...order, movements: [{ id: "movement", otherCarrierPay: [] }] }], "5656", null);
  assert.deepEqual(empty.rows[0].order.otherPay, []);
});

test("does not link the same order to two loads or fall back when a saved ID disagrees", () => {
  const duplicate = buildBookingSyncPreview([load, { ...load, id: "two", sequence: 2 }], [order], "5656", null);
  assert.ok(duplicate.rows.every(row => !row.order));
  const stale = buildBookingSyncPreview([{ ...load, savedOrderId: "another" }], [order], "5656", null);
  assert.equal(stale.rows[0].issue, "Saved SCM order could not be verified");
});
