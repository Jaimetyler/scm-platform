import assert from "node:assert/strict";
import test from "node:test";
import { distanceInMeters, verifyGateLocation, warehouseDate } from "../lib/inbound/checkin/geofence.ts";

const gate = { latitude: 29.75, longitude: -94.98, radiusMeters: 500 };
const now = new Date("2026-09-23T15:00:00.000Z");

test("a fresh accurate location inside the yard is accepted", () => {
  const result = verifyGateLocation({
    gate,
    driver: {
      latitude: 29.751,
      longitude: -94.98,
      accuracyMeters: 15,
      capturedAt: "2026-09-23T14:59:30.000Z",
    },
    now,
  });
  assert.equal(result.ok, true);
  assert.ok("distanceMeters" in result && result.distanceMeters > 100 && result.distanceMeters < 120);
});

test("a driver outside the configured yard radius is rejected", () => {
  const result = verifyGateLocation({
    gate,
    driver: {
      latitude: 29.77,
      longitude: -94.98,
      accuracyMeters: 10,
      capturedAt: "2026-09-23T14:59:30.000Z",
    },
    now,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /at the SCM yard/);
});

test("stale and inaccurate phone locations cannot verify a check-in", () => {
  const stale = verifyGateLocation({
    gate,
    driver: { latitude: 29.75, longitude: -94.98, accuracyMeters: 10, capturedAt: "2026-09-23T14:50:00.000Z" },
    now,
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /expired/);

  const inaccurate = verifyGateLocation({
    gate,
    driver: { latitude: 29.75, longitude: -94.98, accuracyMeters: 300, capturedAt: "2026-09-23T14:59:30.000Z" },
    now,
  });
  assert.equal(inaccurate.ok, false);
  assert.match(inaccurate.error, /not accurate enough/);
});

test("distance calculation handles identical and nearby points", () => {
  assert.equal(distanceInMeters(gate, gate), 0);
  assert.ok(distanceInMeters(gate, { latitude: 29.751, longitude: -94.98 }) > 100);
});

test("received date follows the warehouse timezone", () => {
  const instant = new Date("2026-09-23T03:00:00.000Z");
  assert.equal(warehouseDate(instant, "HOU"), "2026-09-22");
  assert.equal(warehouseDate(instant, "SAV"), "2026-09-22");
});
