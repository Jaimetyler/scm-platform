import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/index.mjs';
import {TOKEN, FIXTURE_ID} from '../fixture.mjs';
const server = http.createServer(handler);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (url, init) => {assert.equal(new URL(url).origin, base); return fetchOriginal(url, init);};
const get = (path, options = {}) => fetch(base + path, {...options, headers: {Authorization: `Bearer ${TOKEN}`, ...options.headers}});
try {
  assert.equal((await get('/__mock/health')).status, 200);
  for (const [path, status] of [
    ['/orders?q=598', 404],
    ['/orders/search?orders.customer_id=BUNGOMNE&orders.status=P&recordLength=5', 422],
    ['/orders/12345678', 404],
    ['/orders/tracking?blnum=598&status=P', 404],
  ]) {
    const response = await get(path);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-scm-fixture-id'), FIXTURE_ID);
    const body = await response.json();
    assert.equal(body.mockOnly, true); assert.equal(body.fixtureId, FIXTURE_ID);
  }
  assert.equal((await get('/__mock/report')).status, 409);
  assert.equal((await get('/__mock/scenario', {method:'POST',body:'{"reference":"CURRENTFAIL","mode":"match"}'})).status, 409);
  for(let i=0;i<2;i++) assert.equal((await get('/orders/search?orders.blnum=*CURRENTFAIL*&recordLength=200')).status, 503);
  assert.equal((await get('/__mock/health',{headers:{Authorization:'Bearer invalid'}})).status, 401);
  assert.equal((await get('/orders/SCM-NORMAL',{headers:{Origin:'https://invalid.example'}})).status, 403);
  assert.equal((await get('/carrierDispatch/clearStop/SCM-NORMAL-SO?arrivalDate=20261013080000-0500&departureDate=20261013090000-0500',{method:'POST'})).status, 200);
  const unchanged = await (await get('/orders/SCM-NORMAL')).json();
  assert.ok(unchanged.stops.every(s => s.actual_arrival === '' && s.actual_departure === ''));
  assert.equal((await get('/orders/search?orders.blnum=*UNKNOWN*&recordLength=5')).status, 422);
  assert.equal((await get('/production')).status, 404);
  assert.equal((await get('/orders/SCM-NORMAL',{method:'DELETE'})).status,405);
  for (const field of ['id', 'blnum', 'consignee_refno']) {
    const value = field === 'id' ? 'OUTSIDE-NONE-1014' : '*OUTSIDE-NONE-1014*';
    const response = await get(`/orders/search?orders.${field}=${value}&recordLength=${field === 'id' ? 2 : 5}`);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
  }
  for (const stop of ['SCM-FRESH-1014-PU', 'SCM-FRESH-1014-SO']) {
    const response = await get(`/carrierDispatch/clearStop/${stop}?arrivalDate=20261014080000-0500&departureDate=20261014090000-0500`, {method:'POST'});
    if (stop.endsWith('-PU')) { assert.equal(response.status, 422); assert.match(await response.text(), /read-only stop/); }
    else { assert.equal(response.status, 200); assert.equal(await response.text(), 'OK'); }
  }
  for (const ref of ['WRONG-YARD-1014', 'NONMAIN-1014', 'PARTIAL-1014']) {
    const response = await get(`/carrierDispatch/clearStop/${ref}-SO?arrivalDate=20261014080000-0500&departureDate=20261014090000-0500`, {method:'POST'});
    assert.equal(response.status, 422);
  }
  console.log('PASS 41 hosted adapter assertions; deterministic scenarios, no cross-request mutable state, writes simulated only.');
} finally { globalThis.fetch = fetchOriginal; await new Promise(r => server.close(r)); }
