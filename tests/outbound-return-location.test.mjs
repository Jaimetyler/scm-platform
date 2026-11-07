import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingReturnLocation} from '../lib/warehouse/outbound/return-location.ts';
import {normalizeBookingDetails} from '../lib/warehouse/outbound/details.ts';

test('Dallas ramp aliases share a filterable McLeod code while preserving source wording',()=>{
 for(const raw of ['UP Wilmer','DIT','UP DIT','UNIOWITX','3701 SOUTH INTERSTATE 45']) {
  assert.deepEqual(bookingReturnLocation(raw),{return_location:raw,return_location_code:'UNIOWITX'});
 }
 for(const raw of ['DALLAS BNSF','Dallas Ramp BNSF Haslet','BNSF Haslet','BNSFHATX'])assert.equal(bookingReturnLocation(raw).return_location_code,'BNSFHATX');
 assert.deepEqual(bookingReturnLocation('Unknown ramp'),{return_location:'Unknown ramp',return_location_code:null});
});
test('booking edits preserve omitted return location, support clearing and reject malformed input',()=>{
 assert.equal(Object.hasOwn(normalizeBookingDetails({}), 'return_location'),false);
 assert.equal(normalizeBookingDetails({returnLocation:' DIT '}).return_location_code,'UNIOWITX');
 assert.equal(normalizeBookingDetails({returnLocation:''}).return_location,null);
 assert.throws(()=>normalizeBookingDetails({returnLocation:42}),/return location/);
 assert.throws(()=>normalizeBookingDetails({returnLocation:'a'.repeat(301)}),/300/);
});
