import test from 'node:test';
import assert from 'node:assert/strict';
import { currentCottonOrder, reconcilableCottonOrder } from '../lib/inbound/checkin/current-cotton-order.ts';

const completed = () => ({ status:'D', __statusDescr:'Delivered', stops:[{ stop_type:'SO',
  sched_arrive_early:'20261023080000-0500', actual_arrival:'20261023090000-0500', actual_departure:'20261023100000-0500' }] });

test('completed discovery is available only to staff reconciliation, not new arrivals', () => {
  assert.equal(currentCottonOrder(completed(),'2026-10-23').eligible,false);
  assert.equal(reconcilableCottonOrder(completed(),'2026-10-23'),true);
});

test('cancelled, incomplete, undated and historical completed candidates stay excluded', () => {
  for (const mutate of [o=>{o.__statusDescr='Cancelled';},o=>{o.stops[0].actual_arrival='';},
    o=>{o.stops[0].actual_departure='';},o=>{o.stops[0].sched_arrive_early='';},
    o=>{o.stops[0].sched_arrive_early='20260101080000-0600';},o=>{o.stops=[];}]) {
    const order=completed();mutate(order);
    assert.equal(reconcilableCottonOrder(order,'2026-10-23'),false);
  }
});
