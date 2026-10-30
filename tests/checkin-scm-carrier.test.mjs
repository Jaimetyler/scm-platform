import assert from "node:assert/strict";
import test from "node:test";
import { classifyScmCarrier } from "../lib/inbound/checkin/scm-carrier.ts";

test("SCM badge requires an assigned carrier code, not merely a McLeod order", () => {
  assert.deepEqual(classifyScmCarrier({ id: "123", vendor_id: "SCMIRIGA" }, ""),
    { carrierCode: "SCMIRIGA", scmCarrier: true });
  assert.deepEqual(classifyScmCarrier({ id: "123", vendor_id: "OTHER" }, ""),
    { carrierCode: "OTHER", scmCarrier: false });
  assert.deepEqual(classifyScmCarrier({ id: "123" }, ""),
    { carrierCode: null, scmCarrier: false });
});

test("current movement carrier takes precedence and configured codes are recognized", () => {
  const order = { vendor_id: "OTHER", curr_movement_id: "M2", movements: [
    { id: "M1", carrier_id: "OTHER" }, { id: "M2", carrier_id: "QFS-SCM" },
  ] };
  assert.deepEqual(classifyScmCarrier(order, "QFS-SCM"),
    { carrierCode: "QFS-SCM", scmCarrier: true });
});
