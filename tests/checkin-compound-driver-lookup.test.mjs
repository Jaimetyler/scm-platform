import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupDriverReference } from '../lib/inbound/checkin/driver-lookup.ts';
import { DependencyError } from '../lib/http/dependency.ts';

const formats = ['81382 / 49001932', '81382/ 49001932', '81382 /49001932', '81382/49001932'];
function order(id, field, reference) {
  return { id, revenue_code_id: 'MAIN', customer_id: 'CUSTOMER', blnum: 'OTHER-PICKUP', consignee_refno: 'OTHER-DELIVERY',
    commodity_id: 'LUMBER', [field]: reference,
    movements: [{ id: 'M1', carrier_name: 'Actual Trucking', override_driver_nm: 'Jordan Driver', override_drvr_cell: '5555551234' }],
    stops: [{ id: 'PU1', movement_id: 'M1', stop_type: 'PU', sched_arrive_early: new Date().toISOString(), location: { name: 'SCM Houston 5300' } },
      { id: 'SO1', movement_id: 'M1', stop_type: 'SO', sched_arrive_early: new Date().toISOString(), location: { name: 'SCM Houston 5300' } }] };
}
async function withMock(rows, run, details = rows) {
  const oldFetch = globalThis.fetch;
  const oldEnv = [process.env.MCLEOD_BASE_URL, process.env.MCLEOD_AUTH_TOKEN];
  process.env.MCLEOD_BASE_URL = 'https://mcleod.invalid'; process.env.MCLEOD_AUTH_TOKEN = 'fixture';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(!init?.method || init.method === 'GET'); assert.ok(init.signal);
    const parsed = new URL(url); calls.push(parsed);
    if (parsed.pathname === '/orders/search') {
      if (parsed.searchParams.has('orders.id')) return Response.json(rows.filter(value => value.id === parsed.searchParams.get('orders.id')));
      const field = parsed.searchParams.has('orders.blnum') ? 'blnum' : 'consignee_refno';
      const pattern = parsed.searchParams.get(`orders.${field}`);
      assert.ok(pattern.startsWith('*') && pattern.endsWith('*'));
      const literal = pattern.slice(1, -1);
      const offset = Number(parsed.searchParams.get('recordOffset'));
      const matching = rows.filter(value => value[field].toUpperCase().includes(literal))
        .sort((left, right) => left.id < right.id ? 1 : left.id > right.id ? -1 : 0);
      return Response.json(matching.slice(offset, offset + Number(parsed.searchParams.get('recordLength'))));
    }
    const id = decodeURIComponent(parsed.pathname.split('/').pop());
    const found = details.find(value => value.id === id);
    assert.ok(found, `Unexpected detail hydration: ${id}`);
    return Response.json(found);
  };
  try { await run(calls); } finally {
    globalThis.fetch = oldFetch;
    for (const [index, name] of ['MCLEOD_BASE_URL', 'MCLEOD_AUTH_TOKEN'].entries()) {
      if (oldEnv[index] === undefined) delete process.env[name]; else process.env[name] = oldEnv[index];
    }
  }
}
const lookup = (input, direction) => lookupDriverReference(input, 'HOU', 'Houston 5300', direction);

test('driver pickup and delivery resolve all stored/input compound formats and preserve original values', async () => {
  for (const direction of ['pickup', 'delivery']) {
    const field = direction === 'pickup' ? 'blnum' : 'consignee_refno';
    for (const stored of formats) {
      const target = order('TARGET', field, stored);
      await withMock([target], async calls => {
        for (const input of [...formats, '81382', '49001932']) {
          const result = await lookup(input, direction);
          assert.equal(result.originalInput, input);
          assert.equal(result.allowUnmatched, false); assert.equal(result.matches.length, 1);
          assert.equal(result.matches[0].orderId, 'TARGET');
          assert.equal(result.matches[0].stopId, direction === 'pickup' ? 'PU1' : 'SO1');
          assert.equal(result.matches[0].order.reference, stored);
          assert.deepEqual(result.matches[0].matchedBy, ['reference']);
        }
        assert.equal(calls.filter(url => url.pathname === '/orders/TARGET').length, 6);
      });
    }
  }
});

test('driver compound discovery never ORs separate orders, separate fields, or contradictory components', async () => {
  for (const direction of ['pickup', 'delivery']) {
    const field = direction === 'pickup' ? 'blnum' : 'consignee_refno';
    const other = field === 'blnum' ? 'consignee_refno' : 'blnum';
    const rows = [order('FIRST', field, '81382'), order('SECOND', field, '49001932'),
      { ...order('OTHER-FIELD', field, '49001932'), [other]: '81382' },
      order('CONTRADICTORY', field, 'WRONG / 49001932'), order('REVERSED', field, '49001932/81382'),
      order('SUBSTRING', field, '81382/490019320')];
    await withMock(rows, async calls => {
      const result = await lookup('81382 /49001932', direction);
      assert.deepEqual(result.matches, []); assert.equal(result.allowUnmatched, true);
      assert.ok(calls.every(url => url.pathname === '/orders/search'), 'No rejected candidate is hydrated');
    });
  }
});

test('hydration accepts changed slash spacing but rejects a changed compound component', async () => {
  for (const direction of ['pickup', 'delivery']) {
    const field = direction === 'pickup' ? 'blnum' : 'consignee_refno';
    const target = order('TARGET', field, formats[0]);
    await withMock([target], async () => {
      const result = await lookup(formats[2], direction);
      assert.equal(result.matches[0].order.reference, formats[3]);
    }, [{ ...target, [field]: formats[3] }]);
    for (const changed of ['81382 / WRONG', 'WRONG / 49001932', '49001932 / 81382', '81382 / 490019320'])
      await withMock([target], async () => {
        await assert.rejects(lookup(formats[3], direction), DependencyError);
      }, [{ ...target, [field]: changed }]);
  }
});

test('driver compound lookup avoids over 100 false short-component hits without dropping leading zeroes', async () => {
  for (const direction of ['pickup', 'delivery']) {
    const field = direction === 'pickup' ? 'blnum' : 'consignee_refno';
    const target = order('TARGET', field, '002951 / 04500281026');
    const rows = [target, ...Array.from({ length: 110 }, (_, index) => order(`FALSE-${index}`, field, `A0029510-${index}`)),
      order('UNPADDED', field, '2951 / 4500281026'), order('HYPHEN-FALSE', field, '002951-X / 04500281026')];
    await withMock(rows, async calls => {
      const result = await lookup('002951/04500281026', direction);
      assert.equal(result.matches.length, 1); assert.equal(result.matches[0].orderId, 'TARGET');
      assert.equal(result.matches[0].order.reference, target[field]);
      assert.equal(calls.filter(url => url.pathname === '/orders/search').length, 1);
      assert.equal(calls[0].searchParams.get(`orders.${field}`), '*04500281026*');
    });
  }
});
