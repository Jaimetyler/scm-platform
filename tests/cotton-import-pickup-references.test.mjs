import test from "node:test";
import assert from "node:assert/strict";
import { draftHoustonOrder } from "../lib/cotton-import/pilot.ts";

const pickup = locationCode => ({ locationCode, scheduledDate: "2026-11-10", timezone: "America/Chicago" });
const preview = {
  customerId: "BUNGOMNE", revenueCode: "MAIN", commodity: "COTTON", deliveryLocation: "SUPPBAT1",
  blnum: "NX005 91 BALES", pickupStops: [pickup("MOODGAT4"), pickup("MOODGAT3")],
};
const source = { salesOrder: "2601771", mark: "NX005", bales: 91, pickups: [{ bales: 40 }, { bales: 51 }] };
const windows = Array(2).fill({ early: "08:00", late: "15:00" });

test("a two-pickup draft preserves the combined BOL and individual PU counts", () => {
  const draft = draftHoustonOrder(source, preview, windows, "V");
  assert.equal(draft.order.blnum, "NX005 91 BALES");
  assert.equal(draft.order.consignee_refno, "NX005");
  assert.equal(draft.order.ordered_by, "2601771");
  assert.equal(draft.order.order_type_id, "FSC");
  assert.deepEqual(draft.pickupReferences, [
    { stopSequence: 1, locationCode: "MOODGAT4", qualifier: "PU", referenceNumber: "NX005 40 BALES" },
    { stopSequence: 2, locationCode: "MOODGAT3", qualifier: "PU", referenceNumber: "NX005 51 BALES" },
  ]);
  assert.throws(() => draftHoustonOrder({ ...source, bales: 90 }, preview, windows, "V"), /do not reconcile/);
});
