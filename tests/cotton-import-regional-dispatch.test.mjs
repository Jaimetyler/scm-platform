import test from "node:test";
import assert from "node:assert/strict";
import { regionalOrder } from "../lib/cotton-import/regional-dispatch.ts";
import { draftHoustonOrder } from "../lib/cotton-import/pilot.ts";
import { houstonPilotPayload } from "../lib/cotton-import/pilot-create.ts";

const locations = ["FUNSMOG3", "BCTGMOGA"].map((code, i) => ({
  id: code, mcleod_code: code, prev_code: String(266405 + i), name: code,
  active: true, timezone: "America/New_York",
}));
const lines = locations.map((location, i) => ({
  so: "2511158", mark: "D1085", warehouse: location.name, warehouseCode: location.prev_code,
  rtl: "2026-11-12", row: i + 4, bales: i === 0 ? 30 : 60, weight: i === 0 ? 15000 : 30000,
}));
test("regional orders use Houston draft rules with the selected terminal and verified pickup mapping", () => {
  for (const [terminal, destination, revenue] of [["savannah", "SAVAGAG2", "MAIN"], ["dallas", "SCMDDETX", "DAVIS"]]) {
    const {source, proposal} = regionalOrder(lines, "2511158", destination, revenue, locations);
    const draft = draftHoustonOrder(source, proposal, Array(2).fill({ early: "07:00", late: "15:00" }), "V");
    const payload = houstonPilotPayload(draft, terminal);
    assert.equal(payload.revenue_code_id, revenue);
    assert.equal(payload.weight, 45000);
    assert.equal(payload.otherCharges[0].amount, 50);
    assert.deepEqual(payload.stops.map(stop => stop.location_id), ["FUNSMOG3", "BCTGMOGA", destination]);
    assert.equal(houstonPilotPayload(draft, "houston"), null);
  }
  assert.throws(() => regionalOrder([lines[0], lines[0]], "2511158", "SAVAGAG2", "MAIN", locations), /Repeated/);
});
