import test from 'node:test';
import assert from 'node:assert/strict';
import { containerInfoRows, containerInfoText, containerInfoHtml } from '../lib/warehouse/outbound/container-info-rows.ts';
import { normalizeBookingDetails } from '../lib/warehouse/outbound/details.ts';
test('customer-facing info includes only current active equipment, including source loads', () => {
  const lines = ['active','on_hold','cancelled'].map((line_status,i)=>({id:String(i),mark:`MARK${i}`,line_status,load_source:'warehouse',source_row:i}));
  lines.push({id:'source',mark:'SOURCE',line_status:'active',load_source:'source_load',source_row:4});
  const containers = ['0','1','2','source'].map((booking_line_id,i)=>({booking_line_id,container_number:`C${i}`,seal_number:`S${i}`,split_transfer_id:null,sequence_no:i}));
  containers.push({...containers[0],container_number:'OLD',split_transfer_id:'transfer'});
  assert.deepEqual(containerInfoRows(lines,containers),[['MARK0','C0','S0'],['SOURCE','C3','S3']]);
  assert.deepEqual(containerInfoRows([lines[0]],[]),[['MARK0','','']]);
});
test('clipboard is tab-delimited and escaped HTML with only customer-facing fields',()=>{
  const booking={customer:'A & B',booking_number:'123',customer_reference:'ref'};
  const rows=[['<MARK>','CONT','SEAL']];
  assert.match(containerInfoText(booking,rows),/Mark\tContainer\tSeal\n<MARK>\tCONT\tSEAL/);
  assert.match(containerInfoHtml(booking,rows),/A &amp; B/);
  assert.match(containerInfoHtml(booking,rows),/&lt;MARK&gt;/);
  assert.doesNotMatch(containerInfoText(booking,rows),/ERD|cutoff/);
});
test('file identifier preserves leading zeros, trims, clears, and validates without changing omitted values',()=>{
  assert.equal(normalizeBookingDetails({scmFileNumber:' 001234 '}).scm_file_number,'001234');
  assert.equal(normalizeBookingDetails({scmFileNumber:''}).scm_file_number,null);
  assert.equal('scm_file_number' in normalizeBookingDetails({}),false);
  assert.throws(()=>normalizeBookingDetails({scmFileNumber:123}));
  assert.throws(()=>normalizeBookingDetails({scmFileNumber:'a'.repeat(81)}));
});
