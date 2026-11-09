import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),XLSX=require('xlsx'),{NextRequest}=require('next/server');
const root=resolve(import.meta.dirname,'..');
const reference={id:'0829475',ordered_by:'2601887',customer_id:'BUNGOMNE',blnum:'TA004 89 BALES',stops:[
 {order_sequence:1,stop_type:'PU',location_id:'MOODGAT3',sched_arrive_early:'20261112080000-0500',sched_arrive_late:'20261112150000-0500'},
 {order_sequence:2,stop_type:'SO',location_id:'SUPPBAT1'}]};
function scenario(options={}){
 let audit=null,payload=null,writes=0;const duplicateCustomers=[];
 const location={id:'loc',mcleod_code:'MOODGAT3',prev_code:'858056',name:'Moody',active:true,timezone:'America/Chicago'};
 const db={from(table){let mutation=null;
  const q={select(){return this},eq(){return this},in(){return this},is(){return this},limit(){return this},
   async upsert(value){audit={id:'audit',mcleod_order_id:null,error_message:null,reviewed_payload:null,updated_at:'2026-01-01',...value};return {error:null}},
   update(value){mutation=value;return this},async maybeSingle(){if(mutation){audit={...audit,...mutation};return {data:{id:'audit'},error:null}}return {data:audit,error:null}},
   then(ok,no){const data=table==='cotton_location_master'?[location]:table==='cotton_location_schedules'?[{location_id:'loc',weekday:null,open_time:'08:00',close_time:'15:00',verified:true,appointment_required:false}]:[];return Promise.resolve({data,error:null}).then(ok,no)}};return q}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 function localRequire(name){
  if(name==='@/lib/auth/guard')return {withStaffAccess:h=>h,staffActor:()=> 'test',staffProfile:()=>({role:'admin'})};
  if(name==='@/lib/auth/session')return {staffDatabase:()=>db};
  if(name==='@/lib/bunge/duplicates')return {nonVoidBlnumMatches:async(_read,_blnum,_dates,customer)=>{duplicateCustomers.push(customer);if(options.lookupError)throw Error('Duplicate lookup incomplete');return options.duplicate?[{id:'existing'}]:[]}};
  if(name==='@/lib/cotton-import/pickup-policy-server')return {readPickupPolicies:async()=>new Map()};
  if(name==='@/lib/bunge/delivery-server')return {readDeliveryLocation:async code=>({code}),readActiveDeliveryLocation:async code=>({code})};
  if(name==='@/lib/dray/server')return {vendor:()=>({read:async path=>path==='/orders/0829475'?reference:{...payload,id:'1234567',stops:payload.stops.map((s,i)=>({...s,id:String(i+1)}))}})};
  if(name.startsWith('@/')||name.startsWith('.')){const f=resolve(name.startsWith('@/')?root:dirname(file),name.startsWith('@/')?name.slice(2):name);return load(f.endsWith('.ts')?f:f+'.ts')}
  return require(name)
 }
 new Function('require','module','exports',code)(localRequire,mod,mod.exports);return mod.exports}
 const POST=load(resolve(root,'app/api/cotton-import/preflight/route.ts')).POST;
 function workbook(customer,terminal){const olam=customer==='OLAMRITX';const rows=olam?[
 ['', 'OLAM AMERICA COTTON COMPANY'],['Carrier:','SUPPLY CHAIN MANAGEMENT LLC'],['Destination:','Merih Logistics'],['','7525 Sutton Road'],['Dest Code:','819201'],['Booking:','BOOK123'],
 ['Mark','','SO','Sale','Bales','Weight','Warehouse','Warehouse Name','Ready/Confirmed Load (RTL)'],['SLT03','',3587071,'TRANSIT',90,41742,858056,'Moody',46339]
 ]:[['Carrier:','SUPPLY CHAIN MANAGEMENT LLC'],['Destination:',terminal==='houston'?'SCM Houston':terminal==='dallas'?'SCM Dallas':'SCM Savannah'],['','Address'],['','City'],
 ['Mark','SO','Sale','Ext.','Bales','','Weight','','','Warehouse','','','Flatbeds','Due','Load (RTL)'],['SLT03','3587071','','',90,'',41742,'','858056','Moody','','','','','11/13/26']];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Dispatch');return XLSX.write(book,{type:'buffer',bookType:'xlsx'})}
 async function call(customer,terminal,destination,token){const form=new FormData();form.set('file',new File([workbook(customer,terminal)],'dispatch.xlsx'));form.set('terminal',terminal);form.set('destination',destination);form.set('equipment','van');form.set('salesOrder','3587071');form.set('customerId',customer);if(token){form.set('action','create-pilot');form.set('reviewToken',token)}return (await POST(new NextRequest('https://example.test/api/cotton-import/preflight',{method:'POST',body:form}))).json()}
 return {call,duplicateCustomers,get writes(){return writes},get payload(){return payload},async withVendor(fn){const saved=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://mcleod.example.test/orders/create');assert.equal(init.method,'PUT');writes++;payload=JSON.parse(init.body);return Response.json({id:'1234567'})};try{return await fn()}finally{globalThis.fetch=saved}}}
}
process.env.BUNGE_IMPORT_WRITES_ENABLED='true';process.env.MCLEOD_BASE_URL='https://mcleod.example.test';process.env.MCLEOD_AUTH_TOKEN='test';
test('Bunge and OLAM create with fresh preflight and read-back across all three terminals',async()=>{
 for(const customer of ['BUNGOMNE','OLAMRITX'])for(const [terminal,scm] of [['houston','SUPPBAT1'],['dallas','SCMDDETX'],['savannah','SAVAGAG2']]){
  const s=scenario(),destination=customer==='OLAMRITX'?'MERIBAT2':scm;
  await s.withVendor(async()=>{const review=await s.call(customer,terminal,destination);assert.equal(review.canCreate,true,JSON.stringify(review));assert.ok(review.reviewToken);assert.equal(s.writes,0);
   const created=await s.call(customer,terminal,destination,review.reviewToken);assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.auditStatus,'verified');assert.equal(s.writes,1);assert.equal(s.payload.customer_id,customer);assert.equal(s.payload.revenue_code_id,terminal==='dallas'?'DAVIS':'MAIN');assert.equal(s.payload.stops.at(-1).location_id,destination);assert.ok(s.duplicateCustomers.every(c=>c===customer));
   if(customer==='OLAMRITX'){assert.equal(s.payload.booking_no_sucm,'BOOK123');assert.match(s.payload.stops.at(-1).sched_arrive_late,/150000/)}
   const again=await s.call(customer,terminal,destination,review.reviewToken);assert.equal(again.canCreate,false);assert.equal(s.writes,1);
  })
 }
});
test('duplicates, failed lookups, mismatched destinations and stale tokens never create',async()=>{
 for(const options of [{duplicate:true},{lookupError:true}]){const s=scenario(options);await s.withVendor(async()=>{const r=await s.call('OLAMRITX','houston','MERIBAT2');assert.equal(r.canCreate,false);assert.equal(s.writes,0)})}
 const s=scenario();await s.withVendor(async()=>{const review=await s.call('OLAMRITX','houston','MERIBAT2');assert.equal(review.canCreate,true);const bad=await s.call('OLAMRITX','houston','MERIBATX',review.reviewToken);assert.equal(bad.canCreate,false);assert.equal(s.writes,0);const cross=await s.call('OLAMRITX','dallas','SAVAGAG2');assert.equal(cross.canCreate,false);assert.equal(s.writes,0)})
});
