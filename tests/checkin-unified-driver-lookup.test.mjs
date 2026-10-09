import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupDriverReference, publicDriverMatch, selectDriverMatch } from '../lib/inbound/checkin/driver-lookup.ts';
import { DependencyError } from '../lib/http/dependency.ts';

function fixture(id = '92157', overrides = {}) {
  return { id, revenue_code_id: 'MAIN', customer_id: 'PRIVATE CUSTOMER', blnum: 'LOAD-456', consignee_refno: 'DEL-987',
    commodity_id: 'LUMBER', movements: [{ id: 'M1', carrier_name: 'Actual Trucking', override_driver_nm: 'Jordan Driver', override_drvr_cell: '555-555-1234' }],
    stops: [{ id: 'PU1', movement_id: 'M1', stop_type: 'PU', sched_arrive_early: new Date().toISOString(), location: { name: 'SCM Houston 5300' } },
      { id: 'SO1', movement_id: 'M1', stop_type: 'SO', sched_arrive_early: new Date().toISOString(), location: { name: 'SCM Houston 5300' } }], ...overrides };
}
async function withMock(orders, search, run, override) {
  const savedFetch = globalThis.fetch;
  const env = [process.env.MCLEOD_BASE_URL, process.env.MCLEOD_AUTH_TOKEN];
  process.env.MCLEOD_BASE_URL = 'https://mcleod.invalid'; process.env.MCLEOD_AUTH_TOKEN = 'fixture';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(!init?.method || init.method === 'GET');
    assert.ok(init.signal, 'Every request has a cancellation deadline');
    const path = new URL(url); calls.push(path);
    if (override) { const result = await override(path, init); if (result !== undefined) return result; }
    if (path.pathname === '/orders/search') return Response.json(typeof search === 'function' ? search(path) : search);
    const id = decodeURIComponent(path.pathname.split('/').pop());
    return orders[id] ? Response.json(orders[id]) : Response.json(null, { status: 404 });
  };
  try { await run(calls); } finally {
    globalThis.fetch = savedFetch;
    for (const [index, name] of ['MCLEOD_BASE_URL', 'MCLEOD_AUTH_TOKEN'].entries()) {
      if (env[index] === undefined) delete process.env[name]; else process.env[name] = env[index];
    }
  }
}
const lookup = (input, direction = 'pickup', selection) => lookupDriverReference(input, 'HOU', 'Houston 5300', direction, selection);

test('one original input resolves an SCM-only number even when its BL does not contain the input', async () => {
  const order = fixture();
  await withMock({ 92157: order }, [], async calls => {
    const result = await lookup(' 92157 ');
    assert.equal(result.originalInput, '92157'); assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].order.reference, 'LOAD-456');
    assert.deepEqual(result.matches[0].matchedBy, ['scm_order']); assert.equal(result.allowUnmatched, false);
    assert.ok(calls.some(url => url.pathname === '/orders/92157')); assert.ok(calls.some(url => url.pathname === '/orders/search'));
  });
});

test('alphanumeric SCM IDs use the same strategy; reference-only input retains original case', async () => {
  const order = fixture('SCM-ABC');
  await withMock({ 'SCM-ABC': order }, [], async () => assert.equal((await lookup('scm-abc')).matches[0].orderId, 'SCM-ABC'));
  await withMock({ 'SCM-ABC': order }, [order], async () => {
    const result = await lookup('Load-456'); assert.equal(result.originalInput, 'Load-456');
    assert.deepEqual(result.matches[0].matchedBy, ['reference']);
  });
});

test('92157 multi-stop fixture uses direction and current yard, then deduplicates both strategies', async () => {
  const order = fixture('92157', { blnum: '92157', consignee_refno: '92157' });
  order.stops.unshift({ id: 'OLD', stop_type: 'PU', actual_departure: '20200101010000-0500', location: { name: 'SCM Houston 4331' } });
  await withMock({ 92157: order }, [order, order], async calls => {
    for (const [direction, stopId] of [['pickup', 'PU1'], ['delivery', 'SO1']]) {
      const result = await lookup('92157', direction);
      assert.equal(result.matches.length, 1); assert.equal(result.matches[0].stopId, stopId);
      assert.equal(result.matches[0].order.completion, null); assert.deepEqual(result.matches[0].matchedBy, ['scm_order', 'reference']);
    }
    assert.equal(calls.filter(url => url.pathname === '/orders/92157').length, 2, 'No duplicate detail hydration');
  });
});

test('one value identifying different SCM-ID and reference orders requires a company/driver choice', async () => {
  const direct = fixture(); const other = fixture('OTHER', { blnum: '92157' });
  other.movements[0].override_driver_nm = 'Casey Driver';
  await withMock({ 92157: direct, OTHER: other }, [other], async () => {
    const result = await lookup('92157'); assert.equal(result.selectionRequired, true); assert.equal(result.matches.length, 2);
    assert.ok(result.matches.every(match => match.selectable)); assert.equal(result.allowUnmatched, false);
    assert.equal(selectDriverMatch(result, 'OTHER', 'PU1', true).orderId, 'OTHER');
    assert.throws(() => selectDriverMatch(result, 'UNRELATED', 'PU1'), /no longer matches/);
    const publicMatches = result.matches.map(publicDriverMatch);
    assert.equal(publicMatches[0].driverPhoneLast4, '1234'); assert.equal(publicMatches[0].carrierName, 'Actual Trucking');
    assert.ok(!JSON.stringify(publicMatches).includes('PRIVATE CUSTOMER'));
    assert.ok(!JSON.stringify(publicMatches).includes('555-555-1234'));
    assert.ok(!Object.hasOwn(publicMatches[0], 'mark'));
  });
});

test('identical company and driver identities cannot be guessed through a selected ID', async () => {
  const direct = fixture(); const other = fixture('OTHER', { blnum: '92157' });
  await withMock({ 92157: direct, OTHER: other }, [other], async () => {
    const result = await lookup('92157'); assert.equal(result.selectionRequired, true);
    assert.ok(result.matches.every(match => !match.selectable));
    for (const match of result.matches) assert.throws(() => selectDriverMatch(result, match.orderId, match.stopId), /contact the office/);
  });
});

test('missing carrier identity is not replaced with an internal carrier code', async () => {
  const direct = fixture(); direct.movements[0] = { id: 'M1', carrier_id: 'SCMH01', override_driver_nm: 'Jordan' };
  const other = fixture('OTHER', { blnum: '92157' });
  await withMock({ 92157: direct, OTHER: other }, [other], async () => {
    const result = await lookup('92157'); const match = result.matches.find(match => match.orderId === '92157');
    assert.equal(publicDriverMatch(match).carrierName, ''); assert.equal(match.selectable, false);
    assert.ok(!JSON.stringify(result.matches.map(publicDriverMatch)).includes('SCMH01'));
  });
});

test('wrong yard, wrong direction, and non-MAIN orders cannot authorize unmatched arrival', async () => {
  for (const change of ['yard', 'direction', 'main']) {
    const order = fixture();
    if (change === 'yard') order.stops.forEach(stop => stop.location.name = 'SCM Houston 4331');
    if (change === 'direction') order.stops = [order.stops[1]];
    if (change === 'main') order.revenue_code_id = 'DRAY';
    await withMock({ 92157: order }, [], async () => await assert.rejects(lookup('92157'), error => error.code === 'YARD_STOP_NOT_FOUND' || error.code === 'NOT_MAIN_ORDER'));
  }
});

test('completed-only and status-only closed results remain visible but never selectable', async () => {
  for (const closed of ['departure', 'status']) {
    const order = fixture();
    if (closed === 'departure') order.stops[0].actual_departure = '20260101090000-0500'; else order.status = 'D';
    await withMock({ 92157: order }, [], async () => {
      const result = await lookup('92157'); assert.equal(result.allowUnmatched, false);
      assert.equal(result.matches[0].selectable, false); assert.ok(publicDriverMatch(result.matches[0]).completion);
      assert.equal(publicDriverMatch(result.matches[0]).completion.carrierCode, '');
    });
  }
});

test('ambiguous same-direction visits and historical results remain blocking outcomes', async () => {
  for (const kind of ['ambiguous', 'historical']) {
    const order = fixture();
    if (kind === 'ambiguous') order.stops.push({ ...order.stops[0], id: 'PU2' });
    else order.stops[0].sched_arrive_early = '20200101090000-0500';
    await withMock({ 92157: order }, [], async () => await assert.rejects(lookup('92157'), error => error.code === (kind === 'ambiguous' ? 'AMBIGUOUS_YARD_STOP' : 'HISTORICAL_ORDER')));
  }
});

test('only a confirmed direct 404 plus complete empty reference search permits no-match', async () => {
  await withMock({}, null, async () => {
    const result = await lookup('NOT-FOUND'); assert.equal(result.allowUnmatched, true); assert.deepEqual(result.matches, []);
  });
  for (const malformed of [null, false, '', {}, { id: 'WRONG', revenue_code_id: 'MAIN' }]) {
    await withMock({}, [], async () => await assert.rejects(lookup('92157'), DependencyError),
      async url => url.pathname === '/orders/92157' ? Response.json(malformed) : undefined);
  }
});

test('either strategy HTTP failure, malformed JSON, or incomplete metadata fails the whole lookup closed', async () => {
  const order = fixture();
  for (const failed of ['direct', 'search', 'body', 'metadata']) {
    await withMock({ 92157: order }, failed === 'metadata' ? [{ id: 'OTHER' }] : [order], async () => {
      await assert.rejects(lookup('92157'), DependencyError);
    }, async url => {
      if (failed === 'direct' && url.pathname === '/orders/92157' || failed === 'search' && url.pathname === '/orders/search') return new Response('', { status: 503 });
      if (failed === 'body' && url.pathname === '/orders/search') return new Response('bad JSON');
    });
  }
});

test('a partial detail hydration failure cannot erase a possible match', async () => {
  const order = fixture(); const other = fixture('OTHER', { blnum: '92157' });
  await withMock({ 92157: order }, [other], async () => await assert.rejects(lookup('92157'), DependencyError));
});

test('search/detail reference drift and stale selected stop are rejected', async () => {
  const order = fixture('OTHER');
  await withMock({ OTHER: order }, [{ ...order, blnum: '92157' }], async () => await assert.rejects(lookup('92157'), DependencyError));
  await withMock({ 92157: fixture() }, [], async () => await assert.rejects(lookup('92157', 'pickup', { orderId: '92157', stopId: 'OLD' }), error => error.code === 'STALE_STOP_SELECTION'));
});

test('both strategies start concurrently and all detail hydration stays at four or fewer', async () => {
  const orders = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`ORDER-${i}`, fixture(`ORDER-${i}`, { blnum: 'REF-123' })]));
  let active = 0, maxActive = 0, directStarted = false, searchStarted = false;
  await withMock(orders, Object.values(orders), async () => {
    const result = await lookup('REF-123'); assert.equal(result.matches.length, 12); assert.ok(maxActive <= 4); assert.ok(maxActive > 1);
    assert.equal(directStarted, true); assert.equal(searchStarted, true);
  }, async url => {
    if (url.pathname === '/orders/REF-123') { directStarted = true; await new Promise(resolve => setImmediate(resolve)); assert.ok(searchStarted); }
    if (url.pathname === '/orders/search') { searchStarted = true; await new Promise(resolve => setImmediate(resolve)); assert.ok(directStarted); }
    if (/\/orders\/ORDER-/.test(url.pathname)) { active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setImmediate(resolve)); active--; }
  });
});

test('oversize, wildcard, and overbroad search input never authorizes no-match', async () => {
  await withMock({}, [], async calls => {
    for (const input of ['AB', '*123*', 'A'.repeat(121)]) await assert.rejects(lookup(input), error => error.code === 'INVALID_LOOKUP_INPUT');
    assert.equal(calls.length, 0);
  });
  const orders = Array.from({ length: 21 }, (_, i) => fixture(`ORDER-${i}`, { blnum: 'REF-123' }));
  await withMock({}, orders, async () => await assert.rejects(lookup('REF-123'), error => error.code === 'TOO_MANY_MATCHES'));
});

test('an ineligible SCM-ID collision does not hide an eligible reference order, or vice versa', async () => {
  for (const ineligiblePath of ['direct', 'reference']) for (const reason of ['yard', 'completed', 'non-main']) {
    const direct = fixture(); const other = fixture('OTHER', { blnum: '92157' });
    const invalid = ineligiblePath === 'direct' ? direct : other;
    if (reason === 'yard') invalid.stops.forEach(stop => stop.location.name = 'SCM Houston 4331');
    if (reason === 'completed') invalid.stops[0].actual_departure = '20260101090000-0500';
    if (reason === 'non-main') invalid.revenue_code_id = 'OTHER';
    await withMock({ 92157: direct, OTHER: other }, [other], async () => {
      const result = await lookup('92157'); const active = result.matches.filter(match => !match.order.completion);
      assert.equal(active.length, 1, `${ineligiblePath}: ${reason}`);
      assert.equal(active[0].orderId, ineligiblePath === 'direct' ? 'OTHER' : '92157');
      assert.equal(active[0].selectable, true); assert.equal(result.selectionRequired, false); assert.equal(result.allowUnmatched, false);
    });
  }
});

test('a failed strategy promptly cancels the other in-flight strategy', async () => {
  let cancelled = false;
  await withMock({}, [], async () => {
    await assert.rejects(lookup('92157'), DependencyError);
    assert.equal(cancelled, true);
  }, async (url, init) => {
    if (url.pathname === '/orders/92157') return new Response('', { status: 503 });
    if (url.pathname === '/orders/search') return await new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { cancelled = true; reject(init.signal.reason); }, { once: true });
    });
  });
});

test('incomplete stop identity or location on either collision path cannot silently leave a unique eligible match', async () => {
  for (const path of ['direct', 'reference']) for (const incomplete of ['no-stops', 'empty-location', 'missing-id', 'missing-type', 'unidentified-yard']) {
    const direct = fixture(), other = fixture('OTHER', { blnum: '92157' });
    const invalid = path === 'direct' ? direct : other;
    if (incomplete === 'no-stops') invalid.stops = [];
    if (incomplete === 'empty-location') invalid.stops[0].location = {};
    if (incomplete === 'missing-id') delete invalid.stops[0].id;
    if (incomplete === 'missing-type') delete invalid.stops[0].stop_type;
    if (incomplete === 'unidentified-yard') invalid.stops[0].location.name = 'SCM';
    await withMock({ 92157: direct, OTHER: other }, [other], async () => await assert.rejects(lookup('92157'), DependencyError));
  }
});

test('missing driver identity data is not positive evidence for distinguishing two loads', async () => {
  for (const missing of ['phone', 'name', 'both']) {
    const direct = fixture(), other = fixture('OTHER', { blnum: '92157' });
    if (missing === 'phone' || missing === 'both') other.movements[0].override_drvr_cell = '';
    if (missing === 'name' || missing === 'both') other.movements[0].override_driver_nm = '';
    await withMock({ 92157: direct, OTHER: other }, [other], async () => {
      const result = await lookup('92157'); assert.equal(result.selectionRequired, true);
      assert.ok(result.matches.every(match => !match.selectable));
    });
  }
});

test('aggregate 20-second deadline bounds response-body consumption and optional carrier enrichment', async () => {
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = milliseconds => originalTimeout(milliseconds === 20_000 ? 10 : milliseconds);
  // Native timeout signals are unref'd; retain a test-only timer while waiting for the abort.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    for (const stalled of ['body', 'carrier']) {
      const order = fixture();
      if (stalled === 'carrier') order.movements[0] = { id: 'M1', carrier_id: 'CARRIER' };
      let aborted = false;
      await withMock({ 92157: order }, [], async () => {
        await assert.rejects(lookup('92157'), DependencyError); assert.equal(aborted, true);
      }, async (url, init) => {
        if (stalled === 'body' && url.pathname === '/orders/92157' || stalled === 'carrier' && url.pathname.startsWith('/carriers/')) {
          return { ok: true, status: 200, json: () => new Promise((resolve, reject) => {
            if (init.signal.aborted) { aborted = true; reject(init.signal.reason); }
            else init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true });
          }) };
        }
      });
    }
  } finally { clearTimeout(keepAlive); AbortSignal.timeout = originalTimeout; }
});
