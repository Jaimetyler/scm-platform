import test from "node:test";
import assert from "node:assert/strict";
import { formatWarehouseTime } from "../lib/inbound/checkin/mcleod-time.ts";

test("Savannah and Houston use their own local offsets", () => {
  const instant = new Date("2026-09-22T14:42:00.000Z");
  assert.equal(formatWarehouseTime(instant, "SAV"), "20260922104200-0400");
  assert.equal(formatWarehouseTime(instant, "HOU"), "20260922094200-0500");
});

test("the same warehouse switches offset after daylight saving ends", () => {
  assert.equal(formatWarehouseTime(new Date("2026-10-31T14:42:00Z"), "SAV"), "20261031104200-0400");
  assert.equal(formatWarehouseTime(new Date("2026-11-02T14:42:00Z"), "SAV"), "20261102094200-0500");
  assert.equal(formatWarehouseTime(new Date("2026-11-01T05:30:00Z"), "SAV"), "20261101013000-0400");
  assert.equal(formatWarehouseTime(new Date("2026-11-01T06:30:00Z"), "SAV"), "20261101013000-0500");
});

test("invalid timestamps cannot be sent to McLeod", () => {
  assert.throws(() => formatWarehouseTime(new Date("invalid"), "SAV"), /Invalid check-in time/);
});
