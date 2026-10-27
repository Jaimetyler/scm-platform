import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as driverLookup from '../lib/inbound/checkin/driver-lookup.ts';
import * as pickupAgreement from '../lib/inbound/checkin/pickup-agreement.ts';
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
function route(writes, { locationOk = true, gate: configuredGate = gate } = {}) {
  const modules = {
    '@/lib/inbound/checkin/pickup-agreement': pickupAgreement,
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
        limit: async () => ({ data: [] }), maybeSingle: async () => ({ data: configuredGate }),
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
    if (override) { const response = await override(path, init); if (response !== undefined) return response; }
    if (path.pathname === '/orders/search') {
      if (path.searchParams.has('orders.id')) {
        const id = path.searchParams.get('orders.id');
        assert.equal(path.searchParams.get('recordLength'), '2');
        assert.ok(!/[*?]/.test(id));
        const order = Object.values(orders).find(order => String(order.id).trim().toUpperCase() === id.toUpperCase());
        return Response.json(order ? [order] : null);
      }
      return Response.json(typeof search === 'function' ? search(path) : search);
    }
    const order = orders[decodeURIComponent(path.pathname.split('/').pop())];
    return order ? Response.json(order) : Response.json(null, { status: 404 });
  };
  const handler = route(writes, options);
  const send = async (body, multipart = false) => {
    const request = multipart ? (() => {
      const form = new FormData(); for (const [key, value] of Object.entries(body)) form.set(key, key === "pickupAgreement" ? JSON.stringify(value) : value);
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
const acceptance = { version: pickupAgreement.PICKUP_AGREEMENT_VERSION, language: 'en', printedName: 'Entered Driver', trailerNumber: 'TEST-TRAILER', productDescription: 'Test lumber', pickupNumber: '92157', referencePo: 'PO-TEST', acknowledged: true, electronicConsent: true, strokes: [[[.1,.2],[.3,.4],[.5,.2]]] };
const submit = { pickupAgreement: acceptance, clientId: token, checkinType: 'domestic', materialType: 'lumber', movementDirection: 'pickup',
  driverName: 'Entered Driver', driverPhone: '555-555-9999', truckingCompany: 'Entered Company', destination: 'Paperwork Receiver',
  orderId: '92157', selectedStopId: 'PU1', referenceNumber: '92157', driverLookupInput: '92157' };

function assertProvisional(result, writes) {
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  const row = writes.at(-1);
  assert.ok(row);
  assert.equal(row.matched_order_id, null);
  assert.equal(row.matched_stop_id, null);
  assert.equal(row.mcleod_lookup_status, 'unresolved');
  assert.equal(row.mcleod_lookup_failure_code, 'LOOKUP_INCOMPLETE');
  assert.equal(row.draft_status, 'checked_in');
  assert.equal(row.verified, false);
  assert.equal(row.processed_at, null);
  assert.notEqual(row.local_receiving_only, true);
  assert.match(row.comment_1, /Provisional driver check-in/);
}

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

test('upstream failure accepts only an unlinked provisional arrival', async () => {
  for (const orderId of ['92157', '']) await withFixture({ 92157: fixture() }, [], async ({ send, writes }) => {
    const result = await send({ ...submit, orderId });
    assertProvisional(result, writes);
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
    assert.equal(calls.filter(url => url.pathname === '/orders/search').length, 4);
    assert.equal(calls.filter(url => url.searchParams.has('orders.id')).length, 2);
    assert.equal(calls.filter(url => url.searchParams.has('orders.blnum')).length, 2);
    assert.ok(calls.every(url => url.pathname === '/orders/search'));
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

for (const site of CHECKIN_SITES) {
  test(`${site.siteName}: unknown numeric input permits outside pickup and delivery for every configured material`, async () => {
    const configuredGate = { ...gate, terminal: site.terminal, site_code: site.siteCode, site_name: site.siteName };
    for (const emptyId of [null, []]) for (const emptyReference of [null, []]) {
      await withFixture({}, emptyReference, async ({ send, writes, calls }) => {
        for (const materialType of site.materials) for (const movementDirection of ['pickup', 'delivery']) {
          const context = `${site.siteCode} ${materialType} ${movementDirection} ID=${JSON.stringify(emptyId)} reference=${JSON.stringify(emptyReference)}`;
          const before = calls.length, beforeWrites = writes.length;
          const lookup = await send({ action: 'lookupReference', referenceNumber: '4040451', movementDirection });
          assert.equal(lookup.response.status, 200, context);
          assert.equal(lookup.body.status, 'no_match', context);
          assert.equal(lookup.body.allowUnmatched, true, context);
          assert.deepEqual(lookup.body.matches, [], context);
          const result = await send({ ...submit, materialType, movementDirection, orderId: '', selectedStopId: '',
            referenceNumber: '4040451', driverLookupInput: '4040451', mark: 'OUTSIDE MARK', bolBaleCount: 10,
          });
          assert.equal(result.response.status, 200, `${context}: ${JSON.stringify(result.body)}`);
          assert.equal(writes.length, beforeWrites + 1, context);
          const write = writes.at(-1);
          assert.equal(write.terminal, site.terminal); assert.equal(write.site_code, site.siteCode);
          assert.equal(write.material_type, materialType); assert.equal(write.movement_direction, movementDirection);
          assert.equal(write.matched_order_id, null); assert.equal(write.matched_stop_id, null);
          assert.equal(write.shipper, null); assert.equal(write.reference_number, '4040451');
          assert.equal(write.driver_lookup_input, '4040451'); assert.equal(write.checkin_source, 'driver_qr');
          assert.equal(write.trucking_company, 'Entered Company');
          const requestCalls = calls.slice(before);
          assert.equal(requestCalls.length, 4, 'Lookup and submit each perform two fresh searches');
          assert.ok(requestCalls.every(url => url.pathname === '/orders/search'), 'Never point-read an unknown input');
          assert.equal(requestCalls.filter(url => url.searchParams.get('orders.id') === '4040451' && url.searchParams.get('recordLength') === '2').length, 2);
          const field = movementDirection === 'pickup' ? 'orders.blnum' : 'orders.consignee_refno';
          assert.equal(requestCalls.filter(url => url.searchParams.get(field) === '*4040451*').length, 2);
        }
      }, async url => url.searchParams.has('orders.id') ? Response.json(emptyId) : undefined, { gate: configuredGate });
    }
  });
}

test('numeric reference-only pickup and delivery preserve the matched order and hydrate it only once', async () => {
  for (const movementDirection of ['pickup', 'delivery']) {
    const order = fixture('OTHER', { blnum: '92157', consignee_refno: '92157' });
    order.stops[0].stop_type = movementDirection === 'pickup' ? 'PU' : 'SO';
    await withFixture({ OTHER: order }, [order], async ({ send, writes, calls }) => {
      const result = await send({ ...submit, orderId: 'OTHER', movementDirection });
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(writes.length, 1); assert.equal(writes[0].matched_order_id, 'OTHER');
      assert.equal(writes[0].matched_stop_id, 'PU1'); assert.equal(writes[0].reference_number, '92157');
      assert.equal(calls.filter(url => url.pathname === '/orders/OTHER').length, 1);
      assert.ok(!calls.some(url => url.pathname === '/orders/92157'));
    });
  }
});

test('invalid search evidence and HTTP failures remain provisional, never outside-carrier evidence', async () => {
  for (const strategy of ['orders.id', 'orders.blnum']) {
    for (const failure of [400, 404, 500, 'json', 'wrapper-null', 'error-envelope']) {
      await withFixture({}, null, async ({ send, writes }) => {
        for (const action of ['lookupReference', 'submit']) {
          const result = await send({ ...submit, action, orderId: '', selectedStopId: '',
            driverLookupInput: '9999999', referenceNumber: '9999999' });
          assert.equal(result.response.status, 200, JSON.stringify(result.body));
          if (action === 'lookupReference') {
            assert.equal(result.body.status, 'provisional');
            assert.deepEqual(result.body.matches, []);
          } else assertProvisional(result, writes);
        }
        assert.equal(writes.length, 1);
      }, async url => {
        if (!url.searchParams.has(strategy)) return undefined;
        if (failure === 'json') return new Response('bad JSON');
        if (failure === 'wrapper-null') return Response.json({ orders: null });
        if (failure === 'error-envelope') return Response.json({ error: 'upstream failed' });
        return Response.json(null, { status: failure });
      });
    }
  }
});

test('disappearing order detail creates an unlinked provisional arrival for staff review', async () => {
  await withFixture({ 92157: fixture() }, [], async ({ send, writes }) => {
    for (const orderId of ['92157', '']) {
      const result = await send({ ...submit, orderId });
      assertProvisional(result, writes);
    }
    assert.equal(writes.length, 2);
  }, async url => url.pathname === '/orders/92157' ? Response.json(null, { status: 404 }) : undefined);
});

test('a stalled search reaches the deadline and records provisional evidence only', async () => {
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = milliseconds => originalTimeout(milliseconds === 20_000 ? 10 : milliseconds);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    for (const strategy of ['orders.id', 'orders.blnum']) {
      let aborted = false;
      await withFixture({}, null, async ({ send, writes }) => {
        const result = await send({ ...submit, orderId: '', selectedStopId: '',
          driverLookupInput: '9999999', referenceNumber: '9999999' });
        assertProvisional(result, writes);
        assert.equal(aborted, true); assert.equal(writes.length, 1);
      }, async (url, init) => {
        if (!url.searchParams.has(strategy)) return undefined;
        return { ok: true, status: 200, json: () => new Promise((resolve, reject) => {
          if (init.signal.aborted) { aborted = true; reject(init.signal.reason); }
          else init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true });
        }) };
      });
    }
  } finally { clearTimeout(keepAlive); AbortSignal.timeout = originalTimeout; }
});

test('pickup submit rejects absent or stale consent without saving a check-in', async () => {
  await withFixture({ '92157': fixture() }, [], async ({ send, writes }) => {
    for (const pickupAgreement of [undefined, { ...acceptance, version: 'old' }, { ...acceptance, strokes: [] }]) {
      const result = await send({ ...submit, pickupAgreement });
      assert.equal(result.response.status, 400, JSON.stringify(result.body));
      assert.equal(writes.length, 0);
    }
    const result = await send({ ...submit, trailerNumber: 'MAIN-TRAILER', pickupAgreement: { ...acceptance, printedName: 'FORGED', pickupNumber: 'FORGED', referencePo: 'FORGED', productDescription: 'FORGED', trailerNumber: 'IGNORED' } });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].trailer_number, 'MAIN-TRAILER');
    assert.equal(writes[0].pickup_agreement.trailerNumber, 'MAIN-TRAILER');
    assert.equal(writes[0].pickup_agreement.printedName, 'ENTERED DRIVER');
    assert.equal(writes[0].pickup_agreement.pickupNumber, '92157');
    assert.equal(writes[0].pickup_agreement.productDescription, 'lumber');
    assert.notEqual(writes[0].pickup_agreement.referencePo, 'FORGED');
    assert.deepEqual(writes[0].pickup_agreement.terms, pickupAgreement.PICKUP_TERMS.en);
    assert.equal(writes[0].pickup_agreement.driverName, 'ENTERED DRIVER');
  });
});
