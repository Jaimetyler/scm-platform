import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("receiving saves retain guarded yard state until atomic completion is implemented", () => {
  const route = read("app/api/inbound/checkin/rows/[id]/route.ts");
  assert.match(route, /yard_status: !existing\.checked_in_at && checked_in_at \? "waiting" : existing\.yard_status/);
  assert.match(route, /\.eq\("yard_status", existing\.yard_status\)/);
});

test("repeat checkout returns local success before remote writes", () => {
  const route = read("app/api/warehouse/domestic-queue/route.ts");
  const completed = route.indexOf('if (row?.yard_status === "completed")');
  const write = route.indexOf('carrierDispatch/clearStop/');
  assert.ok(completed >= 0 && write > completed);
  assert.match(route.slice(completed, write), /already completed; saved status refreshed/);
});

test("verified already-delivered stop skips second remote completion", () => {
  const route = read("app/api/warehouse/domestic-queue/route.ts");
  assert.match(route, /if \(!order\.actualDeparture\)/);
  assert.match(route, /Already delivered in McLeod\. Truck checked out/);
  assert.match(route, /McLeod departure already recorded\. Truck checked out/);
});

test("already-delivered cotton bypasses new actual-time planning", () => {
  const route = read("app/api/inbound/sync/route.ts");
  const completed = route.indexOf('row.source === "live_checkin" && deliveryHas && isSyncEnabled()');
  const plan = route.indexOf('plannedActions = planLiveDeliveryActuals(');
  assert.ok(completed >= 0 && plan > completed, "Completed deliveries must be accepted before new timeline planning");
  assert.match(route.slice(completed, plan), /skipped: true, reason: "Delivery already has actuals"/);
});

test("domestic checkout records physical departure before remote writes", () => {
  const route = read("app/api/warehouse/domestic-queue/route.ts");
  const departure = route.indexOf('physical_departed_at: departure.toISOString()');
  const remote = route.indexOf('carrierDispatch/clearStop/');
  assert.ok(departure >= 0 && remote > departure);
});

test("active line excludes physically departed trucks while McLeod reconciles", () => {
  const line = read("app/warehouse/gate/[terminal]/[siteCode]/line/page.tsx");
  assert.match(line, /!row\.physical_departed_at && \(row\.yard_status/);
});

test("physical departure migration audits and preserves immutable timestamps", () => {
  const sql = read("supabase/migrations/049_physical_departure.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /physical_departure_events/);
  assert.match(sql, /Physical departure is immutable/);
});

test("unrecognized customer can be checked in without a McLeod order", () => {
  const page = read("app/inbound/checkin/[terminal]/[siteCode]/page.tsx");
  const route = read("app/api/inbound/checkin/rows/route.ts");
  assert.match(page, /Customer\/order not yet in McLeod/);
  assert.match(page, /matchedOrderId: manualUnlinkedCheckin \? null/);
  assert.match(page, /if \(!site \|\| !newCheckin \|\| newSaving\) return/);
  assert.match(route, /matched_order_id: matchedOrderId \|\| null/);
});
