import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../app/api/gate/check-in/[token]/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../app/gate/check-in/[token]/page.tsx', import.meta.url), 'utf8');

test('QR lookup describes an unavailable lookup as unverified rather than confirmed no-match', () => {
  assert.match(api, /status: "outside_unverified"/);
  assert.match(api, /if \(provisionalLookupFailure\(error\)\)/);
  assert.match(ui, /result\.status === "outside_unverified"/);
});

test('unavailable and incomplete QR lookups admit provisional pickup/delivery without SCM binding', () => {
  assert.match(api, /error instanceof DependencyError \|\|/);
  assert.match(api, /error instanceof YardStopError && error.code === "INCOMPLETE_LOOKUP"/);
  assert.match(api, /if \(!provisionalLookupFailure\(error\) \|\| orderId\) throw error/);
  assert.match(api, /lookup = await lookupDriverReference\(driverLookupInput/);
  assert.match(api, /comment_2: provisionalOutside \?/);
  assert.doesNotMatch(ui, /Only cotton deliveries may check in during an incomplete/);
  assert.match(ui, /\["matched", "no_match", "outside_unverified"\]\.includes\(lookupStatus\)/);
});

test('provisional status never claims verified outside status or issues McLeod writes', () => {
  assert.match(api, /SCM match not ruled out; staff must reconcile before McLeod processing/);
  assert.match(api, /matched_order_id: orderId \|\| null/);
  assert.match(api, /verified: false/);
  assert.match(api, /draft_status: "checked_in"/);
  assert.match(api, /if \(!orderId\) referenceNumber = driverLookupInput/);
});
