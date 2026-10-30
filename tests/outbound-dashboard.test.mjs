import test from 'node:test';
import assert from 'node:assert/strict';
import { warehouseNow, deadlineMatches, groupBookings } from '../lib/warehouse/outbound/dashboard.ts';
const now = new Date('2026-09-30T14:00:00Z');
const booking = (values = {}) => ({ id: 'one', booking_number: 'TEST-001', terminal: 'SAV', site_code: '984', site_name: 'Savannah 984', customer: 'Bunge',
  status: 'draft', vessel: 'OOCL TEST', erd: null, doc_cutoff: null, cutoff: null, doc_cutoff_has_time: false, cutoff_has_time: false, ...values });

test('today uses each warehouse timezone across midnight', () => {
  const midnight = new Date('2026-10-01T04:30:00Z');
  assert.equal(warehouseNow('SAV', midnight), '2026-10-01T00:30');
  assert.equal(warehouseNow('HOU', midnight), '2026-09-30T23:30');
  assert.equal(deadlineMatches(booking({ cutoff: '2026-09-30T00:00', terminal: 'HOU' }), 'today', midnight), true);
  assert.equal(deadlineMatches(booking({ cutoff: '2026-09-30T00:00' }), 'today', midnight), false);
});

test('date-only cutoff is not passed at midnight; explicit past time is passed', () => {
  assert.equal(deadlineMatches(booking({ cutoff: '2026-09-30T00:00' }), 'past', now), false);
  assert.equal(deadlineMatches(booking({ cutoff: '2026-09-30T09:00', cutoff_has_time: true }), 'past', now), true);
  assert.equal(deadlineMatches(booking({ doc_cutoff: '2026-09-29T00:00', cutoff: '2026-10-01T00:00' }), 'past', now), true);
  assert.equal(deadlineMatches(booking({ cutoff: '2026-10-07T00:00' }), 'upcoming', now), true);
  assert.equal(deadlineMatches(booking({ cutoff: '2026-10-08T00:00' }), 'upcoming', now), false);
});

test('schedule groups keep today/upcoming/past and missing dates distinct', () => {
  const items = [booking({ id: 'past', doc_cutoff: '2026-09-29T00:00' }), booking({ id: 'none' }),
    booking({ id: 'next', cutoff: '2026-10-02T00:00' }), booking({ id: 'today', cutoff: '2026-09-30T00:00' })];
  assert.deepEqual(groupBookings(items, 'schedule', now).map(([name]) => name), ['Today', 'Upcoming', 'Past cutoff', 'Dates needed']);
  assert.equal(groupBookings(items, 'customer', now)[0][1].length, 4);
  assert.deepEqual(groupBookings([booking({ vessel: null }), booking()], 'vessel', now).map(([name]) => name), ['OOCL TEST', 'Vessel needed']);
});

test('ERD filtering is independent of cutoffs, preserves warehouse-local day, and groups by receiving date', () => {
  const item = booking({ erd: '2026-09-30', cutoff: '2026-10-05' });
  assert.equal(deadlineMatches(item, 'today', now, 'erd'), true);
  assert.equal(deadlineMatches(item, 'today', now), false);
  assert.equal(deadlineMatches(item, 'past', now, 'erd'), false);
  assert.equal(deadlineMatches(booking({ erd: '2026-10-07' }), 'upcoming', now, 'erd'), true);
  assert.equal(deadlineMatches(booking({ erd: null }), 'today', now, 'erd'), false);
  assert.deepEqual(groupBookings([booking({ erd: '2026-10-01' }), item, booking()], 'erd').map(([name]) => name), ['2026-09-30', '2026-10-01', 'ERD needed']);
});
