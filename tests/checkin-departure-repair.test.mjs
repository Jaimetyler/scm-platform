import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRepairVerified} from '../lib/inbound/checkin/departure-repair.ts';
const before={id:'0830068',revenue_code_id:'MAIN',customer_id:'BUNGE',consignee_refno:'BU169',blnum:'BU169 91 BALES',status:'D',
 stops:[{id:'PU',stop_type:'PU',actual_arrival:'20261110063000-0500',actual_departure:'20261110074900-0500'},
 {id:'SO',stop_type:'SO',location_id:'SUPPBAT1',actual_arrival:'20261110104500-0500'}],movements:[{id:'M',status:'D',brokerage_status:'DISPATCH'}]};
const completed=()=>({...structuredClone(before),stops:[structuredClone(before.stops[0]),{...before.stops[1],actual_departure:'20261110121200-0500'}],movements:[{id:'M',status:'D',brokerage_status:'FINISHED'}]});
const verify=after=>departureRepairVerified(before,after,'SO','20261110111253-0600');
test('repair confirms timezone-equivalent minute-precision departure and finished brokerage',()=>assert.equal(verify(completed()),true));
test('repair refuses mismatched identity, changed existing actuals, missing departure or unfinished brokerage',()=>{
 for(const mutate of [
  o=>o.id='OTHER',o=>o.customer_id='OTHER',o=>o.blnum='OTHER',o=>o.movements[0].brokerage_status='DISPATCH',
  o=>o.movements[0].id='OTHER',o=>o.stops[1].actual_departure=null,o=>o.stops[1].actual_departure='20261110131300-0500',
  o=>o.stops[1].location_id='OTHER',o=>o.stops[1].actual_arrival='20261110104600-0500',o=>o.stops[0].actual_departure=null,
 ]) {const after=completed();mutate(after);assert.equal(verify(after),false);}
});
