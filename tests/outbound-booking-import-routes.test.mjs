import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import XLSX from 'xlsx';
import * as parser from '../lib/warehouse/outbound/booking-import.ts';
import * as sites from '../lib/inbound/checkin/sites.ts';
import * as details from '../lib/warehouse/outbound/details.ts';
const require=createRequire(import.meta.url);
const headers=['ocean_carrier_name','ocean_vessel_name','stuffing_reference','carrier_booking_number','exporter_ref_po_number','container_num_stuffed','stuffing_place','earliest_return_date','terminal_cutoff','document_cutoff','full_return_place','empty_pickup_place'];
function file() {const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headers,['EVERGREEN','EVER MAGIC','W0282','TEST-BOOK','PO-TEST','EGSU1373670','USDAL','05 Nov 10:00','01 Nov 19:00','06 Nov 11:00','Dallas','Dallas']]),'Data');return XLSX.write(w,{type:'buffer',bookType:'xlsx'});}
function handler(path) {
 const calls=[]; const mod={exports:{}};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const local=n=>n==='@/lib/auth/guard'?{withStaffAccess:fn=>fn}:n==='@/lib/warehouse/outbound/booking-import'?parser:n==='@/lib/inbound/checkin/sites'?sites:n==='@/lib/warehouse/outbound/details'?details:n==='@supabase/supabase-js'?{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:'11111111-1111-4111-8111-111111111111',error:null};}})}:require(n);
 new Function('require','module','exports',code)(local,mod,mod.exports);return {post:mod.exports.POST,calls};
}
function request(fields={}) {const form=new FormData();form.set('file',new File([file()],'renamed.xlsx'));form.set('terminal','DAL');form.set('siteCode','SCMDDETX');for(const [k,v]of Object.entries(fields))form.set(k,String(v));return new Request('https://example.test',{method:'POST',body:form});}
test('preview recognizes content even when renamed and does not need database/McLeod writes',async()=>{
 const {post}=handler('app/api/warehouse/outbound/preview/route.ts');const response=await post(request());const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.booking.sourceFormat,'edf');assert.equal(data.booking.lines[0].containerNumber,'EGSU1373670');
});
test('save rejects missing counts/confirmations, then passes original container/mark pairing to the atomic draft RPC',async()=>{
 process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 try {
  const {post,calls}=handler('app/api/warehouse/outbound/bookings/route.ts');
  assert.equal((await post(request())).status,400);assert.equal(calls.length,0);
  const fields={dateYear:'2026',customerConfirmed:'true',warehouseConfirmed:'true',datesConfirmed:'true',erd:'2026-11-05',docCutoff:'2026-11-06T11:00',cutoff:'2026-11-01T19:00',vessel:'EVER MAGIC'};
  assert.equal((await post(request(fields))).status,400);assert.equal(calls.length,0);
  const response=await post(request({...fields,lineBales:JSON.stringify({2:88})}));assert.equal(response.status,200);
  assert.equal(calls[0].name,'create_cotton_outbound_booking_import');assert.equal(calls[0].args.p_customer,'ED&F Man Cotton');
  assert.equal(calls[0].args.p_lines[0].containerNumber,'EGSU1373670');assert.equal(calls[0].args.p_lines[0].mark,'W0282');assert.equal(calls[0].args.p_total_bales,88);
 }finally {delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;}
});
