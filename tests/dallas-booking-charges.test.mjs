import test from "node:test";
import assert from "node:assert/strict";
import { readBookingMarkCharges } from "../lib/dray/booking-charges.ts";
import { getCheckinSite } from "../lib/inbound/checkin/sites.ts";

test("reads all matching Bunge orders at the Dallas booking yard and preserves every returned charge", async () => {
  const source = { customer_id: "BUNGOMNE", blnum: "A0250 90 BALES", consignee_refno: "A0250",
    status: "A", rate: "125.00", rate_units: "1", total_charge: "140",
    other_charges: [{ charge_id: "040", descr: "Chassis", units: "1", rate: "15", amount: "15" }],
    stops: [{ id: "PU1", stop_type: "PU", location_id: "SCMDDETX" }] };
  const orders = [
    { ...source, id: "101", revenue_code_id: "DAVIS" },
    { ...source, id: "102", revenue_code_id: "DDRAY", other_charges: undefined },
    { ...source, id: "103", revenue_code_id: "DDRAY", stops: [{ id: "PU2", stop_type: "PU", location_id: "SCMDDATX" }] },
    { ...source, id: "104", revenue_code_id: "DDRAY", customer_id: "OTHER" },
  ];
  const reads = [];
  const result = await readBookingMarkCharges(async path => {
    reads.push(path);
    return path.startsWith("/orders/search?") ? orders : orders.find(order => path.endsWith("/" + order.id));
  }, getCheckinSite("DAL", "SCMDDETX"), "A0250", new AbortController().signal);
  assert.deepEqual(result.map(order => order.id), ["101", "102"]);
  assert.deepEqual(result[0].charges, [{ code: "040", description: "Chassis", units: 1, rate: 15, amount: 15 }]);
  assert.equal(result[0].total, 140);
  assert.equal(result[1].charges, null);
  assert.equal(reads.filter(path => path === "/orders/101").length, 1);
});
