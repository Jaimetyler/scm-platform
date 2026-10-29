import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredLocalReceiving, isLocalReceivingCustomer } from '../lib/inbound/checkin/local-receiving.ts';
test('explicit King Ranch policy uses exact customer aliases and never erases vendor evidence',()=>{
  const row={shipper:'  King   Ranch ',draft_status:'checked_in'};
  assert.equal(isLocalReceivingCustomer(row.shipper),true);
  assert.equal(configuredLocalReceiving(row),true);
  for(const customer of ['KING RANCH TRANSPORT','NEW CUSTOMER','BUNGE',''])assert.equal(isLocalReceivingCustomer(customer),false);
  for(const extra of [{matched_order_id:'ORDER'},{matched_stop_id:'STOP'},{mcleod_lookup_has_known_match:true},
    {mcleod_processing_phase:'write_pending'},{mcleod_processing_phase:'legacy_review'},
    {draft_status:'processing'},{draft_status:'failed'},{outside_carrier_override_at:'2026-10-01'}])
    assert.equal(configuredLocalReceiving({...row,...extra}),false,JSON.stringify(extra));
  assert.equal(configuredLocalReceiving({...row,draft_status:'failed',mcleod_processing_phase:'lookup',mcleod_lookup_attempt_id:'ATTEMPT'}),true);
});
