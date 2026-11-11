import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlanningInfo } from '../lib/warehouse/outbound/planning-info.ts';
import { CHECKIN_SITES } from '../lib/inbound/checkin/sites.ts';
const site = CHECKIN_SITES.find(site => site.siteCode === 'SCMDDETX');
const order = (id, carrier = null) => ({ id, booking_no_sucm: 'BK1', customer_id: 'BUNGOMNE', revenue_code_id: 'DDRAY', status: 'A',
  stops: [{ id: `s${id}`, movement_id: `m${id}`, stop_type: 'PU', location_id: 'SCMDDETX', actual_departure: null }],
  movements: [{ id: `m${id}`, carrier_id: carrier }] });
const lookup = (orders, planned = orders.length, override) => readPlanningInfo(override || (async path => path.startsWith('/orders/search?') ? orders.map(({ id }) => ({ id })) : orders.find(order => path === `/orders/${order.id}`)),
  { booking_number: 'BK1', planned_containers: planned }, site, ['BUNGOMNE'], AbortSignal.timeout(2000));

test('carrierless matched orders count as uncovered; assigned carrier stays covered', async () => {
  const a = order('1', 'CARRIER1'), b = order('2');
  a.stops[0].actual_departure = '2026-11-10T10:00:00';
  const result = await lookup([a, b]);
  assert.equal(result.uncovered, 1); assert.deepEqual(result.uncoveredOrderIds, ['2']); assert.deepEqual(result.carriers, ['CARRIER1']);
  assert.equal(result.complete, true); assert.equal(result.loaded, 1);
});
test('empty results and incomplete planned order count never imply fully covered', async () => {
  assert.equal((await lookup([], 2)).complete, false);
  const result = await lookup([order('1')], 2);
  assert.equal(result.uncovered, 1); assert.equal(result.complete, false); assert.equal(result.loaded, null);
});
test('unknown movement carrier fields and relay movements stay unverified', async () => {
  const a = order('1'); delete a.movements[0].carrier_id;
  const b = order('2'); b.movements = [{ id: 'wrong', carrier_id: null }];
  const result = await lookup([a, b]);
  assert.equal(result.unknownCarriers, 2); assert.equal(result.uncovered, 0); assert.equal(result.complete, false);
});
test('other bookings, customers, cancelled orders, and other Dallas sites are excluded', async () => {
  const orders = ['1','2','3','4'].map(id => order(id));
  orders[0].booking_no_sucm = 'OTHER'; orders[1].customer_id = 'OTHER';
  orders[2].status = 'V'; orders[3].stops[0].location_id = 'SCMDDATX';
  assert.equal((await lookup(orders)).matchedOrders, 0);
});
test('a repeated full page fails instead of silently reporting coverage', async () => {
  const orders = ['1','2','3','4','5'].map(id => order(id));
  await assert.rejects(lookup(orders), /complete order list/);
});
test('search failure or unreadable response never becomes uncovered', async () => {
  await assert.rejects(lookup([], 2, async () => ({ error: 'unavailable' })), /incomplete booking search/);
  await assert.rejects(lookup([], 2, async () => { throw Error('offline'); }), /offline/);
});
