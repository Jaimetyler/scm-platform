import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as driverLookup from '../lib/inbound/checkin/driver-lookup.ts';
import * as dependency from '../lib/http/dependency.ts';
import * as yard from '../lib/inbound/checkin/yard-stop.ts';
import { CHECKIN_SITES } from '../lib/inbound/checkin/sites.ts';
const require = createRequire(import.meta.url);
const token = '12345678-1234-4234-8234-123456789012';
const gate = { id: 'gate', terminal: 'HOU', site_code: '5300', site_name: 'Houston 5300', latitude: 1, longitude: 1, radius_m: 200 };
function fixture(id = '92157', extra = {}) {
  return { id, revenue_code_id: 'MAIN', customer_id: 'PRIVATE CUSTOMER', blnum: 'Canonical Ref-456', consignee_refno: 'DEL-987',
    commodity_id: 'LUMBER', movements: [{ id: 'M1', carrier_name: 'Actual Trucking', override_driver_nm: 'Known Driver', override_drvr_cell: '555-555-1234' }],
    stops: [{ id: 'PU1', movement_id: 'M1', stop_type: 'PU', sched_arrive_early: new Date().toISOString(), location: { name: 'SCM Houston 5300' } }], ...extra };
}
function route(writes, { locationOk = true } = {}) {
  const modules = {
    'next/server': { NextResponse: Response },
    '@/lib/inbound/checkin/driver-lookup': driverLookup,
    '@/lib/http/dependency': dependency,
    '@/lib/inbound/checkin/yard-stop': yard,
    '@/lib/inbound/checkin/sites': { CHECKIN_SITES },
    '@/lib/inbound/checkin/container-device': {},
    '@/lib/inbound/checkin/shortage': { cottonShortage: () => null },
    '@/lib/inbound/checkin/geofence': { verifyGateLocation: () => locationOk ? { ok: true, distanceMeters: 0 } : { ok: false, error: 'Not at this yard' }, warehouseDate: () => new Date().toISOString().slice(0, 10) },
    '@supabase/supabase-js': { createClient: () => ({ from(table) {
      let write;
      return { select() { return this; }, eq() { return this; }, or() { return this; },
        limit: async () => ({ data: [] }), maybeSingle: async () => ({ data: gate }),
        insert(value) { write = value; writes.push(value); return this; }, single: async () => ({ data: { ...write } }) };
    } }) },
  };
  const source = ts.transpileModule(readFileSync(new URL('../app/api/gate/check-in/[token]/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => modules[name] || require(name), module, module.exports);
  return module.exports.POST;
}
async function withFixture(orders, search, run, override, options = {}) {
  const previousFetch = globalThis.fetch;
  const names = ['MCLEOD_BASE_URL', 'MCLEOD_AUTH_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => process.env[name] = name.endsWith('URL') ? 'https://fixture.invalid' : 'fixture');
  const writes = [], calls = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(!init?.method || init.method === 'GET'); const path = new URL(url); calls.push(path);
    if (override) { const response = await override(path); if (response !== undefined) return response; }
    if (path.pathname === '/orders/search') return Response.json(typeof search === 'function' ? search(path) : search);
    const order = orders[decodeURIComponent(path.pathname.split('/').pop())];
    return order ? Response.json(order) : Response.json(null, { status: 404 });
  };
  const handler = route(writes, options);
  const send = async (body, multipart = false) => {
    const request = multipart ? (() => {
      const form = new FormData(); for (const [key, value] of Object.entries(body)) form.set(key, value);
      return new Request('https://scm.invalid/', { method: 'POST', body: form });
    })() : new Request('https://scm.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await handler(request, { params: Promise.resolve({ token }) });
    return { response, body: await response.json() };
  };
  try { await run({ writes, calls, send }); } finally {
    globalThis.fetch = previousFetch;
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
}
const submit = { clientId: token, checkinType: 'domestic', materialType: 'lumber', movementDirection: 'pickup',
  driverName: 'Entered Driver', driverPhone: '555-555-9999', truckingCompany: 'Entered Company', destination: 'Paperwork Receiver',
  orderId: '92157', selectedStopId: 'PU1', referenceNumber: '92157', driverLookupInput: '92157' };

test('SCM-only JSON and multipart submissions persist actual order/stop, canonical reference, and original input separately', async () => {
  for (const multipart of [false, true]) {
    const order = fixture('SCM-ABC');
    await withFixture({ 'SCM-ABC': order }, [], async ({ writes, send }) => {
      const result = await send({ ...submit, orderId: 'SCM-ABC', driverLookupInput: '  scm-abc  ', referenceNumber: 'scm-abc' }, multipart);
      assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(writes.length, 1);
      assert.equal(writes[0].matched_order_id, 'SCM-ABC'); assert.equal(writes[0].matched_stop_id, 'PU1');
      assert.equal(writes[0].reference_number, 'CANONICAL REF-456'); assert.equal(writes[0].driver_lookup_input, 'scm-abc');
      assert.equal(writes[0].driver_phone, '555-555-9999', 'Never replace entered driver phone with another driver');
    });
  }
});

test('reference-only submission persists the original partial input independently of canonical reference', async () => {
  const order = fixture();
  await withFixture({ 92157: order }, [order], async ({ writes, send }) => {
    const result = await send({ ...submit, driverLookupInput: 'ref-456', referenceNumber: 'ref-456' });
    assert.equal(result.response.status, 200); assert.equal(writes[0].reference_number, 'CANONICAL REF-456');
    assert.equal(writes[0].driver_lookup_input, 'ref-456');
  });
});

test('lookup contract offers company and masked driver identity, without customer or full phone', async () => {
  const order = fixture();
  await withFixture({ 92157: order }, [], async ({ send, writes }) => {
    const search = await send({ action: 'lookupReference', referenceNumber: '92157', movementDirection: 'pickup' });
    assert.equal(search.response.status, 200); assert.equal(search.body.status, 'matches'); assert.equal(search.body.allowUnmatched, false);
    assert.equal(search.body.matches[0].driverPhoneLast4, '1234'); assert.equal(search.body.matches[0].driverName, 'Known Driver');
    const detail = await send({ action: 'lookupOrder', orderId: '92157', selectedStopId: 'PU1', driverLookupInput: '92157', movementDirection: 'pickup' });
    assert.equal(detail.response.status, 200); assert.equal(detail.body.orderId, '92157'); assert.equal(detail.body.driverPhoneLast4, '1234');
    for (const body of [search.body, detail.body]) {
      assert.ok(!JSON.stringify(body).includes('PRIVATE CUSTOMER')); assert.ok(!JSON.stringify(body).includes('555-555-1234'));
      assert.ok(!Object.hasOwn(body, 'customer')); assert.ok(!Object.hasOwn(body, 'carrierCode'));
    }
    assert.equal(writes.length, 0);
  });
});

test('a forged unrelated selection or omitted selection cannot bypass fresh unified resolution', async () => {
  await withFixture({ 92157: fixture() }, [], async ({ send, writes }) => {
    for (const changes of [{ driverLookupInput: 'UNRELATED' }, { orderId: '', selectedStopId: '' }, { orderId: 'OTHER' }, { selectedStopId: 'STALE' }]) {
      const result = await send({ ...submit, ...changes }); assert.equal(result.response.status, 409, JSON.stringify(result.body));
    }
    assert.equal(writes.length, 0);
  });
});

test('lookup success never authorizes stale completed, wrong-yard, or changed-reference submission', async () => {
  for (const change of ['complete', 'yard', 'reference']) {
    const order = fixture();
    await withFixture({ 92157: order }, () => [order], async ({ send, writes }) => {
      const result = await send({ action: 'lookupReference', referenceNumber: 'ref-456', movementDirection: 'pickup' });
      assert.equal(result.response.status, 200);
      if (change === 'complete') order.stops[0].actual_departure = '20261009090000-0500';
      if (change === 'yard') order.stops[0].location.name = 'SCM Houston 4331';
      if (change === 'reference') order.blnum = 'DIFFERENT';
      const result2 = await send({ ...submit, driverLookupInput: 'ref-456', referenceNumber: 'ref-456' });
      assert.equal(result2.response.status, 409, JSON.stringify(result2.body)); assert.equal(writes.length, 0);
    });
  }
});

test('partial upstream failure blocks selected and fake no-match submissions with retryable 503', async () => {
  for (const orderId of ['92157', '']) await withFixture({ 92157: fixture() }, [], async ({ send, writes }) => {
    const result = await send({ ...submit, orderId }); assert.equal(result.response.status, 503);
    assert.equal(result.response.headers.get('Retry-After'), '10'); assert.equal(writes.length, 0);
  }, async url => url.pathname === '/orders/search' ? new Response('', { status: 503 }) : undefined);
});

test('known wrong-yard, ambiguous, or completed input cannot masquerade as an unmatched outside arrival', async () => {
  for (const state of ['wrong-yard', 'ambiguous', 'completed']) {
    const order = fixture();
    if (state === 'wrong-yard') order.stops[0].location.name = 'SCM Houston 4331';
    if (state === 'ambiguous') order.stops.push({ ...order.stops[0], id: 'PU2' });
    if (state === 'completed') order.status = 'D';
    await withFixture({ 92157: order }, [], async ({ send, writes }) => {
      const result = await send({ ...submit, orderId: '', selectedStopId: '' });
      assert.equal(result.response.status, 409, `${state}: ${JSON.stringify(result.body)}`); assert.equal(writes.length, 0);
    });
  }
});

test('indistinguishable active company and driver records cannot bypass chooser through lookupOrder or submit', async () => {
  const direct = fixture(), other = fixture('OTHER', { blnum: '92157' });
  await withFixture({ 92157: direct, OTHER: other }, [other], async ({ send, writes }) => {
    for (const action of ['lookupOrder', 'submit']) {
      const result = await send({ ...submit, action }); assert.equal(result.response.status, 409);
      assert.match(result.body.error, /contact the office/);
    }
    assert.equal(writes.length, 0);
  });
});

test('genuine confirmed no-match permits the existing paperwork flow after a fresh recheck', async () => {
  await withFixture({}, null, async ({ send, writes, calls }) => {
    const lookup = await send({ action: 'lookupReference', referenceNumber: 'UNKNOWN', movementDirection: 'pickup' });
    assert.equal(lookup.body.status, 'no_match'); assert.equal(lookup.body.allowUnmatched, true);
    const result = await send({ ...submit, orderId: '', selectedStopId: '', referenceNumber: 'unknown', driverLookupInput: 'unknown' });
    assert.equal(result.response.status, 200); assert.equal(writes[0].matched_order_id, null); assert.equal(writes[0].matched_stop_id, null);
    assert.equal(writes[0].reference_number, 'UNKNOWN'); assert.equal(writes[0].driver_lookup_input, 'unknown');
    assert.equal(calls.filter(url => url.pathname === '/orders/search').length, 2);
  });
});

test('GPS rejection occurs before either lookup strategy or submission writes', async () => {
  await withFixture({ 92157: fixture() }, [], async ({ send, writes, calls }) => {
    for (const action of ['lookupReference', 'lookupOrder', 'submit']) assert.equal((await send({ ...submit, action })).response.status, 403);
    assert.equal(calls.length, 0); assert.equal(writes.length, 0);
  }, undefined, { locationOk: false });
});

test('a unique result that becomes ambiguous at detail or submit requires a deliberate company/driver selection', async () => {
  const direct = fixture(), other = fixture('OTHER', { blnum: '92157' });
  other.movements[0].override_driver_nm = 'Different Driver';
  let includeOther = false;
  await withFixture({ 92157: direct, OTHER: other }, () => includeOther ? [other] : [], async ({ send, writes }) => {
    const lookup = await send({ action: 'lookupReference', referenceNumber: '92157', movementDirection: 'pickup' });
    assert.equal(lookup.body.matches.length, 1);
    includeOther = true;
    for (const action of ['lookupOrder', 'submit']) {
      const result = await send({ ...submit, action, explicitSelection: false });
      assert.equal(result.response.status, 409); assert.equal(result.body.code, 'SELECTION_REQUIRED');
    }
    assert.equal(writes.length, 0);
    const confirmed = await send({ ...submit, explicitSelection: true });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body)); assert.equal(writes.length, 1);
  });
});
