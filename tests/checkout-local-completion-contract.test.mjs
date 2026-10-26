import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("saving complete cotton receiving closes the local yard visit", () => {
  const route = read("app/api/inbound/checkin/rows/[id]/route.ts");
  assert.match(route, /yard_status: \["ready", "delivery_blocked"\]\.includes\(draft_status\) && checked_in_at/);
  assert.match(route, /yard_completed_at: at/);
  assert.match(route, /\.eq\("yard_status", existing\.yard_status\)/);
});

test("repeat checkout returns local success before remote writes", () => {
  const route = read("app/api/warehouse/domestic-queue/route.ts");
  const completed = route.indexOf('if (row?.yard_status === "completed")');
  const write = route.indexOf('fetch(\x60\x24{base}/carrierDispatch/clearStop/');
  assert.ok(completed >= 0 && write > completed);
  assert.match(route.slice(completed, write), /already completed; saved status refreshed/);
});

test("verified already-delivered stop skips second remote completion", () => {
  const route = read("app/api/warehouse/domestic-queue/route.ts");
  assert.match(route, /if \(!order\.actualDeparture\)/);
  assert.match(route, /Already delivered in McLeod\. Truck checked out/);
  assert.match(route, /McLeod departure already recorded\. Truck checked out/);
});
