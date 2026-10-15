import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../app/api/gate/check-in/[token]/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../app/gate/check-in/[token]/page.tsx', import.meta.url), 'utf8');

test('QR lookup describes an unavailable lookup as unverified rather than confirmed no-match', () => {
  assert.match(api, /status: "outside_unverified"/);
  assert.match(api, /direction === "delivery" && error instanceof DependencyError/);
  assert.match(ui, /result\.status === "outside_unverified"/);
});

test('only server-observed failures for unlinked cotton deliveries can save provisional outside arrivals', () => {
  assert.match(api, /error instanceof DependencyError\) \|\| orderId \|\| materialType !== "cotton" \|\| movementDirection !== "delivery"/);
  assert.match(api, /lookup = await lookupDriverReference\(driverLookupInput/);
  assert.match(api, /comment_2: provisionalOutside \?/);
  assert.match(ui, /form\.materialType !== "cotton" \|\| form\.movementDirection !== "delivery"/);
});
