import test from 'node:test';import assert from 'node:assert/strict';
import {locationPhones} from '../lib/cotton-locations/contact-match.mjs';
const row={__type:'contact',company_id:'TMS',id:'contact1',parent_row_type:'L',parent_row_id:'ALBEEDNC',is_active:'Y',contact_name:'Office',phone:'252-555-0100'};
test('matches exact location and excludes inactive and unrelated contacts',()=>{
 assert.equal(locationPhones([row,{...row,phone:'252-555-0199',is_active:'N'},{...row,parent_row_type:'C',phone:'252-555-0198'}],'ALBEEDNC').selected.phone,row.phone);
 assert.equal(locationPhones([{...row,parent_row_id:'OTHER'}],'ALBEEDNC').selected,null);
});
test('deduplicates formatting, prefers office, and leaves conflicting office numbers for review',()=>{
 assert.ok(locationPhones([row,{...row,phone:'(252) 555-0100',mobile_phone:'2525550198'}],'ALBEEDNC').selected);
 assert.equal(locationPhones([row,{...row,phone:'2525550199'}],'ALBEEDNC').selected,null);
 assert.equal(locationPhones([{...row,phone:'',mobile_phone:'2525550198'}],'ALBEEDNC').selected.field,'mobile_phone');
 assert.equal(locationPhones([{...row,phone:'000',mobile_phone:''}],'ALBEEDNC').candidates.length,0);
 assert.throws(()=>locationPhones(Array(100).fill(row),'ALBEEDNC'),/Incomplete/);
});
