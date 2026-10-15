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
    if (path.pathname === '/orders/search') {
      if (path.searchParams.has('orders.id')) {
        const id = path.searchParams.get('orders.id');
        assert.equal(path.searchParams.get('recordLength'), '2', 'Exact-ID search must detect nonunique responses');
        assert.ok(!/[*?]/.test(id), 'Exact-ID search must not use wildcards');
        const order = Object.values(orders).find(order => String(order.id).trim().toUpperCase() === id.toUpperCase());
        return Response.json(order ? [order] : null);
      }
      assert.equal(path.searchParams.get('recordLength'), '5', 'Reference discovery uses the documented small page size');
      assert.equal(path.searchParams.has('orderBy'), false, 'Use the vendor default ID-descending order; never send the failing override');
      const offset = Number(path.searchParams.get('recordOffset'));
      assert.ok(Number.isInteger(offset) && offset >= 0 && offset % 5 === 0);
      assert.deepEqual([...path.searchParams.keys()].sort(), [
        path.searchParams.has('orders.blnum') ? 'orders.blnum' : 'orders.consignee_refno',
        'recordLength', 'recordOffset',
      ].sort(), 'No undocumented OR, regex, yard, or date query predicates');
      // Array fixtures behave like ordered, offset-paged upstream results. A
      // callback deliberately owns its page contents for malformed/paging tests.
      const compare = (left, right) => {
        const a = String(left?.id ?? '').trim().toUpperCase(), b = String(right?.id ?? '').trim().toUpperCase();
        return a < b ? 1 : a > b ? -1 : 0;
      };
      const payload = typeof search === 'function' ? search(path) :
        Array.isArray(search) ? [...search].sort(compare).slice(offset, offset + 5) : search;
      return Response.json(payload);
    }
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
    assert.equal(calls.filter(url => url.pathname === '/orders/92157').length, 1);
    assert.ok(calls.some(url => url.searchParams.get('orders.id') === '92157'));
    assert.ok(calls.some(url => url.searchParams.get('orders.blnum') === '*92157*'));
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

test('complete empty exact-ID and reference searches permit no-match without a point read', async () => {
  for (const idPayload of [null, [], { orders: [] }]) for (const referencePayload of [null, []]) {
    await withMock({}, referencePayload, async calls => {
      const result = await lookup('9999999');
      assert.equal(result.allowUnmatched, true); assert.deepEqual(result.matches, []);
      assert.equal(calls.length, 2); assert.ok(calls.every(url => url.pathname === '/orders/search'));
      assert.equal(calls.filter(url => url.searchParams.get('orders.id') === '9999999').length, 1);
    }, async url => url.searchParams.has('orders.id') ? Response.json(idPayload) : undefined);
  }
});

test('numeric reference-only input hydrates the returned order without probing the input as an order', async () => {
  const order = fixture('OTHER', { blnum: '92157' });
  await withMock({ OTHER: order }, [order], async calls => {
    const result = await lookup('92157');
    assert.equal(result.matches.length, 1); assert.deepEqual(result.matches[0].matchedBy, ['reference']);
    assert.equal(result.matches[0].orderId, 'OTHER'); assert.equal(result.allowUnmatched, false);
    assert.equal(calls.filter(url => url.pathname === '/orders/OTHER').length, 1);
    assert.ok(!calls.some(url => url.pathname === '/orders/92157'));
  });
});

test('unexpected exact-ID rows, duplicates, wildcard IDs, and incomplete metadata fail closed', async () => {
  const order = fixture();
  for (const payload of [false, '', {}, { orders: null }, { data: null }, { error: 'upstream failed' },
    { id: '92157', revenue_code_id: 'MAIN' }, [null], [order, order], [order, fixture('OTHER')],
    [fixture('WRONG')], [fixture('92157*')], [{ id: '92157' }], [{ id: '', revenue_code_id: 'MAIN' }]]) {
    await withMock({ 92157: order }, [], async calls => {
      await assert.rejects(lookup('92157'), DependencyError);
      assert.ok(calls.every(url => url.pathname === '/orders/search'), 'Reject invalid search evidence before hydration');
    }, async url => url.searchParams.has('orders.id') ? Response.json(payload) : undefined);
  }
});

test('either search HTTP failure or malformed JSON fails the whole lookup closed', async () => {
  for (const strategy of ['orders.id', 'orders.blnum']) for (const failure of [400, 404, 500, 503, 'body']) {
    await withMock({ 92157: fixture() }, [], async () => {
      await assert.rejects(lookup('92157'), DependencyError);
    }, async url => {
      if (url.searchParams.has(strategy)) return failure === 'body' ? new Response('bad JSON') : Response.json(null, { status: failure });
    });
  }
  for (const payload of [false, '', {}, { orders: null }, { data: null }, { error: 'upstream failed' }, [{ id: 'OTHER' }]]) {
    await withMock({ 92157: fixture() }, payload, async () => await assert.rejects(lookup('92157'), DependencyError));
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
  let active = 0, maxActive = 0, idStarted = false, referenceStarted = false;
  await withMock(orders, Object.values(orders), async () => {
    const result = await lookup('REF-123'); assert.equal(result.matches.length, 12); assert.ok(maxActive <= 4); assert.ok(maxActive > 1);
    assert.equal(idStarted, true); assert.equal(referenceStarted, true);
  }, async url => {
    if (url.searchParams.has('orders.id')) { idStarted = true; await new Promise(resolve => setImmediate(resolve)); assert.ok(referenceStarted); }
    if (url.searchParams.has('orders.blnum')) { referenceStarted = true; await new Promise(resolve => setImmediate(resolve)); assert.ok(idStarted); }
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

test('either failed search promptly cancels the other in-flight search', async () => {
  for (const failed of ['orders.id', 'orders.blnum']) {
    let cancelled = false;
    await withMock({}, [], async () => {
      await assert.rejects(lookup('92157'), DependencyError);
      assert.equal(cancelled, true);
    }, async (url, init) => {
      if (url.searchParams.has(failed)) return new Response('', { status: 503 });
      if (url.pathname === '/orders/search') return await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => { cancelled = true; reject(init.signal.reason); }, { once: true });
      });
    });
  }
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
    for (const stalled of ['id-body', 'reference-body', 'later-page-body', 'hydration-body', 'carrier']) {
      const order = fixture();
      if (stalled === 'carrier') order.movements[0] = { id: 'M1', carrier_id: 'CARRIER' };
      let aborted = false;
      const search = stalled === 'later-page-body' ? Array.from({ length: 5 }, (_, i) => fixture(`FALSE-${i}`, { blnum: '12921570' })) : [];
      await withMock({ 92157: order }, search, async () => {
        await assert.rejects(lookup('92157'), DependencyError); assert.equal(aborted, true);
      }, async (url, init) => {
        if (stalled === 'id-body' && url.searchParams.has('orders.id') ||
            stalled === 'reference-body' && url.searchParams.has('orders.blnum') ||
            stalled === 'later-page-body' && url.searchParams.has('orders.blnum') && url.searchParams.get('recordOffset') === '5' ||
            stalled === 'hydration-body' && url.pathname === '/orders/92157' ||
            stalled === 'carrier' && url.pathname.startsWith('/carriers/')) {
          return { ok: true, status: 200, json: () => new Promise((resolve, reject) => {
            if (init.signal.aborted) { aborted = true; reject(init.signal.reason); }
            else init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true });
          }) };
        }
      });
    }
  } finally { clearTimeout(keepAlive); AbortSignal.timeout = originalTimeout; }
});

test('observed 4040451 absence contract: legacy detail would be 204, but exact and reference searches allow outside freight', async () => {
  let legacyProbeCalls = 0;
  await withMock({}, null, async calls => {
    for (const direction of ['pickup', 'delivery']) {
      const result = await lookupDriverReference('4040451', 'SAV', 'Savannah - 1601', direction);
      assert.equal(result.allowUnmatched, true);
      assert.deepEqual(result.matches, []);
    }
    assert.equal(legacyProbeCalls, 0, 'Unknown input must never depend on the legacy detail absence response');
    assert.equal(calls.length, 4);
    assert.ok(calls.every(url => url.pathname === '/orders/search'));
  }, async url => {
    if (url.pathname === '/orders/4040451') {
      legacyProbeCalls++;
      return new Response(null, { status: 204 });
    }
  });
});


test('real multi-valued BL 2951 / 4500281026 resolves the same order from either whole reference', async () => {
  for (const direction of ['pickup', 'delivery']) {
    const field = direction === 'pickup' ? 'blnum' : 'consignee_refno';
    const order = fixture('REAL-BL', { [field]: '2951 / 4500281026' });
    await withMock({ 'REAL-BL': order }, [order], async calls => {
      for (const input of ['2951', '4500281026', '2951 / 4500281026']) {
        const result = await lookup(input, direction);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].orderId, 'REAL-BL');
        assert.equal(result.matches[0].order.reference, '2951 / 4500281026');
        assert.deepEqual(result.matches[0].matchedBy, ['reference']);
        assert.equal(result.allowUnmatched, false);
      }
      const falseSubstring = await lookup('129510', direction);
      assert.equal(falseSubstring.matches.length, 0); assert.equal(falseSubstring.allowUnmatched, true);
      assert.equal(calls.filter(url => url.pathname === '/orders/REAL-BL').length, 3);
    });
  }
});

test('whole-reference boundaries reject internal substrings without hydrating false candidates', async () => {
  const falseValues = ['129510', '29510', 'A2951', '2951B', '02951', 'AB_2951', '2951.0', 'AB.2951'];
  const rows = falseValues.map((blnum, i) => fixture(`FALSE-${i}`, { blnum }));
  await withMock({}, rows, async calls => {
    const result = await lookup('2951');
    assert.deepEqual(result.matches, []); assert.equal(result.allowUnmatched, true);
    assert.ok(calls.every(url => url.pathname === '/orders/search'));
    assert.deepEqual(calls.filter(url => url.searchParams.has('orders.blnum')).map(url => url.searchParams.get('recordOffset')), ['0', '5']);
  });
});

test('space slash and hyphen separators match without splitting entered alphanumeric references', async () => {
  for (const blnum of ['2951 4500281026', '2951/4500281026', '2951-4500281026', 'OTHER / AbC-0012 / LAST']) {
    const order = fixture('SEPARATED', { blnum });
    const input = blnum.includes('AbC') ? 'abc-0012' : '4500281026';
    await withMock({ SEPARATED: order }, [order], async () => {
      const result = await lookup(input); assert.equal(result.matches.length, 1); assert.equal(result.matches[0].orderId, 'SEPARATED');
    });
  }
  for (const blnum of ['ABC', '0012', 'XABC-0012', 'ABC-0012X']) {
    await withMock({}, [fixture('FRAGMENT', { blnum })], async calls => {
      const result = await lookup('ABC-0012'); assert.deepEqual(result.matches, []); assert.equal(result.allowUnmatched, true);
      assert.ok(calls.every(url => url.pathname === '/orders/search'));
    });
  }
});

test('leading zeroes remain significant for both entered references and exact SCM IDs', async () => {
  const padded = fixture('00092157', { blnum: '002951 / ABC-0007' });
  const unpadded = fixture('92157', { blnum: '2951 / ABC-7' });
  await withMock({ '00092157': padded, 92157: unpadded }, [unpadded, padded], async calls => {
    for (const [input, id] of [['002951', '00092157'], ['2951', '92157'], ['ABC-0007', '00092157'], ['ABC-7', '92157'], ['00092157', '00092157']]) {
      const result = await lookup(input); assert.equal(result.matches.length, 1); assert.equal(result.matches[0].orderId, id);
    }
    assert.ok(calls.some(url => url.searchParams.get('orders.id') === '00092157'));
  });
});

test('a full-field exact reference never suppresses later-page multi-valued matches', async () => {
  const exact = fixture('Z-EXACT', { blnum: '2951' });
  const multiple = fixture('A-MULTIPLE', { blnum: '2951 / 4500281026' });
  multiple.movements[0].override_driver_nm = 'Different Driver';
  const falseHits = Array.from({ length: 4 }, (_, i) => fixture(`M-FALSE-${i}`, { blnum: '129510' }));
  await withMock({ 'Z-EXACT': exact, 'A-MULTIPLE': multiple }, [multiple, ...falseHits, exact], async calls => {
    const result = await lookup('2951');
    assert.deepEqual(result.matches.map(match => match.orderId), ['A-MULTIPLE', 'Z-EXACT']);
    assert.equal(result.selectionRequired, true); assert.equal(result.allowUnmatched, false);
    assert.ok(result.matches.every(match => match.selectable));
    assert.throws(() => selectDriverMatch(result, 'Z-EXACT', 'PU1'), error => error.code === 'SELECTION_REQUIRED');
    assert.equal(calls.filter(url => !url.pathname.endsWith('/search')).length, 2);
    assert.deepEqual(calls.filter(url=>url.searchParams.has('orders.blnum')).map(url=>url.searchParams.get('recordOffset')), ['0','5']);
  });
});

test('later eligible order is discovered after historical, other-yard and substring-only pages', async () => {
  const old = Array.from({ length: 5 }, (_, i) => {
    const order = fixture(`Z-OLD-${i}`, { blnum: '2951' }); order.stops[0].sched_arrive_early = '20200101090000-0500'; return order;
  });
  const elsewhere = Array.from({ length: 5 }, (_, i) => {
    const order = fixture(`Y-ELSEWHERE-${i}`, { blnum: '2951 / OTHER' });
    order.stops.forEach(stop => stop.location.name = 'SCM Houston 4331'); return order;
  });
  const falseHits = Array.from({ length: 5 }, (_, i) => fixture(`X-FALSE-${i}`, { blnum: '129510' }));
  const eligible = fixture('A-ELIGIBLE', { blnum: '2951 / 4500281026' });
  const rows = [...old, ...elsewhere, ...falseHits, eligible];
  await withMock(Object.fromEntries([...old, ...elsewhere, eligible].map(order => [order.id, order])), rows, async calls => {
    const result = await lookup('2951'); assert.equal(result.matches.length, 1); assert.equal(result.matches[0].orderId, 'A-ELIGIBLE');
    assert.equal(result.selectionRequired, false); assert.equal(result.allowUnmatched, false);
    assert.deepEqual(calls.filter(url => url.searchParams.has('orders.blnum')).map(url => url.searchParams.get('recordOffset')), ['0', '5', '10', '15']);
    assert.equal(calls.filter(url => !url.pathname.endsWith('/search')).length, 11);
  });
});

test('many raw false substring hits do not consume the true-candidate hydration cap', async () => {
  const falseHits = Array.from({ length: 26 }, (_, i) => fixture(`A-FALSE-${String(i).padStart(2, '0')}`, { blnum: '129510' }));
  const eligible = fixture('Z-ELIGIBLE', { blnum: '2951 / 4500281026' });
  await withMock({ 'Z-ELIGIBLE': eligible }, [eligible, ...falseHits], async calls => {
    const result = await lookup('2951'); assert.equal(result.matches.length, 1); assert.equal(result.matches[0].orderId, 'Z-ELIGIBLE');
    assert.equal(calls.filter(url => url.searchParams.has('orders.blnum')).length, 6);
    assert.deepEqual(calls.filter(url => !url.pathname.endsWith('/search')).map(url => url.pathname), ['/orders/Z-ELIGIBLE']);
  });
});

test('exactly full pages require a final empty page before hydration or confirmed no-match', async () => {
  for (const trueMatch of [false, true]) {
    const rows = Array.from({ length: 5 }, (_, i) => fixture(`ORDER-${i}`, { blnum: trueMatch ? '2951' : '129510' }));
    await withMock(Object.fromEntries(rows.map(order => [order.id, order])), rows, async calls => {
      const result = await lookup('2951');
      assert.equal(result.matches.length, trueMatch ? 5 : 0); assert.equal(result.allowUnmatched, !trueMatch);
      const searches = calls.filter(url => url.searchParams.has('orders.blnum'));
      assert.deepEqual(searches.map(url => url.searchParams.get('recordOffset')), ['0', '5']);
      if (trueMatch) assert.ok(calls.indexOf(searches[1]) < calls.findIndex(url => url.pathname === '/orders/ORDER-0'));
    });
  }
});

test('20 true reference IDs plus a distinct exact SCM ID hydrate only after complete paging', async () => {
  const exact = fixture('2951', { blnum: 'SEPARATE' });
  const references = Array.from({ length: 20 }, (_, i) => fixture(`REF-${String(i).padStart(2, '0')}`, { blnum: '2951 / OTHER' }));
  await withMock(Object.fromEntries([exact, ...references].map(order => [order.id, order])), references, async calls => {
    const result = await lookup('2951'); assert.equal(result.matches.length, 21); assert.equal(result.allowUnmatched, false);
    assert.equal(calls.filter(url => !url.pathname.endsWith('/search')).length, 21);
    assert.deepEqual(calls.filter(url => url.searchParams.has('orders.blnum')).map(url => url.searchParams.get('recordOffset')), ['0', '5', '10', '15', '20']);
    assert.deepEqual(result.matches[0].matchedBy, ['scm_order']);
  });
});

test('over 20 true reference candidates fails before any hydration or exact-ID shortcut', async () => {
  const exact = fixture('2951');
  const rows = Array.from({ length: 21 }, (_, i) => fixture(`REF-${String(i).padStart(2, '0')}`, { blnum: '2951 / OTHER' }));
  await withMock({ 2951: exact }, rows, async calls => {
    await assert.rejects(lookup('2951'), error => error.code === 'TOO_MANY_MATCHES');
    assert.ok(calls.every(url => url.pathname === '/orders/search'));
    assert.equal(calls.filter(url => url.searchParams.has('orders.blnum')).length, 5);
  });
});

test('100 raw rows on the last full budget page fail closed even with a unique exact-ID match', async () => {
  for (const hasExact of [false, true]) {
    const rows = Array.from({ length: 100 }, (_, i) => fixture(`FALSE-${String(i).padStart(3, '0')}`, { blnum: '129510' }));
    await withMock(hasExact ? { 2951: fixture('2951') } : {}, rows, async calls => {
      await assert.rejects(lookup('2951'), error => error.code === 'INCOMPLETE_LOOKUP');
      const referenceCalls = calls.filter(url => url.searchParams.has('orders.blnum'));
      assert.equal(referenceCalls.length, 20); assert.equal(referenceCalls.at(-1).searchParams.get('recordOffset'), '95');
      assert.equal(calls.length, 21); assert.ok(calls.every(url => url.pathname === '/orders/search'));
    });
  }
});

test('a short twentieth page can prove exhaustion within the 100-row scan budget', async () => {
  const rows = Array.from({ length: 99 }, (_, i) => fixture(`FALSE-${String(i).padStart(3, '0')}`, { blnum: '129510' }));
  await withMock({}, rows, async calls => {
    const result = await lookup('2951'); assert.equal(result.allowUnmatched, true); assert.deepEqual(result.matches, []);
    assert.equal(calls.filter(url => url.searchParams.has('orders.blnum')).length, 20);
  });
});

test('repeated full pages and cross-page overlap fail closed instead of becoming unique or outside matches', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => fixture(`ORDER-${i}`, { blnum: i === 0 ? '2951' : '129510' }));
  for (const second of [rows, [rows[4]], [fixture('ORDER-NEW', { blnum: '129510' }), rows[0]]]) {
    await withMock({ 2951: fixture('2951') }, url => Number(url.searchParams.get('recordOffset')) === 0 ? rows : second, async calls => {
      await assert.rejects(lookup('2951'), DependencyError);
      assert.equal(calls.filter(url => url.searchParams.has('orders.blnum')).length, 2);
      assert.ok(calls.every(url => url.pathname === '/orders/search'));
    });
  }
});

test('inconsistent duplicate search evidence and a server-ignored page length fail closed', async () => {
  const order = fixture('SAME', { blnum: '2951' });
  for (const rows of [[order, { ...order, blnum: '129510' }], [order, { ...order, revenue_code_id: 'OTHER' }],
    Array.from({ length: 6 }, (_, i) => fixture(`ORDER-${i}`, { blnum: '2951' }))]) {
    await withMock({}, () => rows, async calls => {
      await assert.rejects(lookup('2951'), DependencyError); assert.ok(calls.every(url => url.pathname === '/orders/search'));
    });
  }
});

test('later-page HTTP, body and incomplete metadata errors cannot retain an earlier unique candidate', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => fixture(`FIRST-${i}`, { blnum: i === 0 ? '2951' : '129510' }));
  for (const failure of ['http', 'body', 'shape', 'reference', 'metadata']) {
    await withMock({ 2951: fixture('2951') }, rows, async calls => {
      await assert.rejects(lookup('2951'), DependencyError); assert.ok(calls.every(url => url.pathname === '/orders/search'));
    }, async url => {
      if (!url.searchParams.has('orders.blnum') || url.searchParams.get('recordOffset') !== '5') return;
      if (failure === 'http') return Response.json(null, { status: 503 });
      if (failure === 'body') return new Response('bad JSON');
      if (failure === 'shape') return Response.json({ data: null });
      if (failure === 'reference') return Response.json([{ id: 'LATER', revenue_code_id: 'MAIN' }]);
      return Response.json([{ id: 'LATER', blnum: '129510' }]);
    });
  }
});

test('the whole-reference rule is checked again on fresh detail hydration', async () => {
  for (const blnum of ['129510', '2951X', 'X2951', '02951']) {
    const detail = fixture('CHANGED', { blnum });
    await withMock({ CHANGED: detail }, [{ ...detail, blnum: '2951 / 4500281026' }], async () => {
      await assert.rejects(lookup('2951'), DependencyError);
    });
  }
});


test('non-scalar search or hydration evidence fails closed rather than erasing a competing candidate', async () => {
  for (const invalid of [{ id: 123 }, { revenue_code_id: {} }, { revenue_code_id: ['MAIN'] }, { blnum: ['2951'] }, { blnum: { reference: '2951' } }]) {
    const malformed = { ...fixture('MALFORMED', { blnum: '2951' }), ...invalid };
    await withMock({ 2951: fixture('2951') }, [malformed], async calls => {
      await assert.rejects(lookup('2951'), DependencyError); assert.ok(calls.every(url => url.pathname === '/orders/search'));
    });
  }
  const other = fixture('OTHER', { blnum: '2951' });
  for (const revenue_code_id of [true, {}, ['MAIN']]) {
    await withMock({ 2951: fixture('2951'), OTHER: { ...other, revenue_code_id } }, [other], async () => {
      await assert.rejects(lookup('2951'), DependencyError);
    });
  }
});

test('same-page duplicate rows with different object key order hydrate once after validation', async () => {
  const order = fixture('DUPLICATE', { blnum: '2951 / 4500281026' });
  const reordered = Object.fromEntries(Object.entries(order).reverse());
  await withMock({ DUPLICATE: order }, [order, reordered], async calls => {
    const result = await lookup('2951'); assert.equal(result.matches.length, 1);
    assert.equal(calls.filter(url => url.pathname === '/orders/DUPLICATE').length, 1);
  });
});

test('offset-only default-descending pages retain a later whole-token load without the observed failing sort overrides', async () => {
  for (const input of ['2951', '4500281026']) {
    const actual = fixture('A-LOAD', { blnum: '2951 / 4500281026' });
    const rows = [...Array.from({length:8},(_,i)=>fixture(`Z-FALSE-${i}`, {blnum:`1${input}0`})),actual];
    await withMock({ 'A-LOAD':actual }, rows, async calls => {
      const result = await lookup(input);
      assert.deepEqual(result.matches.map(m=>m.orderId), ['A-LOAD']);
      const pages = calls.filter(url=>url.searchParams.has('orders.blnum'));
      assert.deepEqual(pages.map(url=>url.searchParams.get('recordOffset')), ['0','5']);
      assert.ok(pages.every(url=>!url.searchParams.has('orderBy')));
      assert.equal(calls.filter(url=>url.pathname==='/orders/A-LOAD').length,1);
      assert.ok(!calls.some(url=>url.pathname.startsWith('/orders/Z-FALSE')));
    }, async url => url.searchParams.has('orderBy') ? new Response('synthetic sort failure', {status:url.searchParams.get('orderBy').includes('+')?400:500}) : undefined);
  }
});

test('1088937 pickup with optional slash and complete container reference resolves through BLNUM', async () => {
  const order = fixture('REAL-1088937', { blnum: '1088937 / TGBU5277117' });
  await withMock({ 'REAL-1088937': order }, [], async calls => {
    for (const input of ['1088937', '1088937/', '1088937/TGBU5277117', '1088937 / TGBU5277117', '1088937/ TGBU5277117']) {
      const result = await lookup(input);
      assert.equal(result.matches.length, 1, input);
      assert.equal(result.matches[0].orderId, 'REAL-1088937');
      assert.equal(result.matches[0].order.reference, '1088937 / TGBU5277117');
      assert.equal(result.allowUnmatched, false);
    }
    const searches = calls.filter(url => url.searchParams.has('orders.blnum'));
    assert.equal(searches.length, 5);
    assert.ok(searches.every(url => url.searchParams.get('orders.blnum') === '*1088937*'));
  }, (url) => {
    if (url.searchParams.get('orders.blnum') === '*1088937*') return Response.json([order]);
    if (url.searchParams.has('orders.blnum')) return Response.json([]);
    return undefined;
  });
});

test('compound pickup must match both slash components, never just the first', async () => {
  const order = fixture('REAL-1088937', { blnum: '1088937 / TGBU5277117' });
  await withMock({ 'REAL-1088937': order }, [order], async () => {
    const result = await lookup('1088937/TGBU0000000');
    assert.equal(result.matches.length, 0);
    assert.equal(result.allowUnmatched, true);
  });
});
