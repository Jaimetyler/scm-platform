import assert from "node:assert/strict";
import test from "node:test";
import { containerDeviceHash, validContainerDeviceId } from "../lib/inbound/checkin/container-device.ts";

test("container device IDs must be browser-generated UUIDs", () => {
  assert.equal(validContainerDeviceId("7d9bea6e-e613-4c26-a741-57b8fdddf89e"), true);
  assert.equal(validContainerDeviceId("not-a-device"), false);
});

test("container device hashes are stable without storing the browser token", () => {
  const first = containerDeviceHash("7d9bea6e-e613-4c26-a741-57b8fdddf89e");
  const repeated = containerDeviceHash("7D9BEA6E-E613-4C26-A741-57B8FDDDF89E");
  const different = containerDeviceHash("8f39cadc-b2a9-4d85-8672-a0444c4df159");
  assert.equal(first, repeated);
  assert.notEqual(first, different);
  assert.equal(first.length, 64);
});
