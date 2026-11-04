import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';
const require=createRequire(import.meta.url);const cache=new Map();
function load(path){if(cache.has(path))return cache.get(path);const mod={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n==='@/lib/mcleod/inbound/search-response'?load('lib/mcleod/inbound/search-response.ts'):require(n),mod,mod.exports);cache.set(path,mod.exports);return mod.exports;}
const {parseDispatch,buildPreview}=load('lib/bunge/preview.ts');const {availableBlnumMatches}=load('lib/bunge/duplicates.ts');
const loc=(id,code,prev)=>({id,mcleod_code:code,prev_code:prev,name:code,address:'Street',city:'Town',state:'GA',timezone:'America/New_York'});
const locations=[loc('l1','FUNSMOG3','266405'),loc('l2','BCTGMOGA','304495'),loc('dest','SAVAGAG2',null)];
const line=(x={})=>({sheet:'Sheet1',row:1,mark:'D1085',so:'2511158',bales:30,weight:null,warehouse:'FUNSTON GIN CO',warehouseCode:'266405',address:[],rtl:'2026-04-30',...x});
const schedule=(x={})=>({location_id:'l1',weekday:4,open_time:'08:00',close_time:'15:00',checkin_cutoff:null,verified:false,appointment_required:null,effective_from:null,effective_to:null,created_at:'2026-11-03T10:00:00Z',source_reference:'History',...x});
const csv=rows=>Buffer.from(rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n'));
const headers=['Mark','SO','Sale','Ext.','Bales','','Weight','','','Warehouse','','','Flatbeds','Due','Load (RTL)'];
const row=(x={})=>{const r=Array(15).fill('');Object.assign(r,{0:'D1085',1:'2511158',4:30,8:'266405',9:'FUNSTON GIN CO',14:'04/30/26',...x});return r};
test('groups SO plus mark, sums two pickups, builds BLNUM and preserves date/row provenance',()=>{
 const [p]=buildPreview([line(),line({row:2,bales:60,warehouse:'BCT',warehouseCode:'304495'})],locations,[schedule()], 'MAIN');
 assert.equal(p.blnum,'D1085 90 BALES');assert.equal(p.pickups.length,2);assert.equal(p.customerId,'BUNGOMNE');assert.equal(p.destination,'SAVAGAG2');assert.deepEqual(p.pickups.map(s=>s.bales),[30,60]);assert.match(p.pickups[0].issues.join(),/unverified/);
});
test('parses repeated dispatch sections, ignores freight/fuel, inherits only unique warehouse codes, excludes other carrier',()=>{
 const parsed=parseDispatch(csv([['Carrier:','Supply Chain Management LLC OTR'],['Destination:','SCM Savannah'],headers,row(),['','','','','','','','','','400 Main St'],['','','','','','','','','','','','','','','','Freight','','690'],row({0:'D1086',1:'2511159',8:''}),['Carrier:','Z- CARRIER TBA'],headers,row({0:'OTHER',1:'9999'})]));
 assert.equal(parsed.lines.length,2);assert.equal(parsed.lines[1].warehouseCode,'266405');assert.equal(parsed.excluded.length,1);assert.equal(parsed.lines.reduce((n,l)=>n+l.bales,0),60);
});
test('conflicting warehouse labels do not propagate a guessed code; partial pickup identities fail',()=>{
 const parsed=parseDispatch(csv([['Carrier:','Supply Chain Management LLC'],headers,row(),row({0:'D1086',1:'2511159',8:'304495'}),row({0:'D1087',1:'2511160',8:''})]));assert.equal(parsed.lines[2].warehouseCode,'');
 assert.throws(()=>parseDispatch(csv([['Carrier:','Supply Chain Management LLC'],headers,row({0:''})])),/missing mark or SO/);
});
test('mapping ambiguity, missing dates and repeated source rows stay visible',()=>{
 const [p]=buildPreview([line({rtl:null}),line({rtl:null})],[...locations,loc('other','OTHER','266405')],[], 'DAVIS');assert.equal(p.pickups[0].location,null);assert.match(p.pickups[0].issues.join(),/multiple locations/);assert.match(p.pickups[0].issues.join(),/RTL date missing/);assert.match(p.issues.join(),/Repeated/);
});
test('uses source weekday and effective range; does not apply Thursday hours to Friday',()=>{
 const [p]=buildPreview([line({rtl:'2026-05-01'})],locations,[schedule(),schedule({weekday:5,close_time:'11:30',effective_from:'2026-01-01',effective_to:'2026-06-01'})], 'MAIN');assert.equal(p.pickups[0].hours.close_time,'11:30');
 const [unknown]=buildPreview([line({rtl:'2026-07-03'})],locations,[schedule({weekday:5,effective_to:'2026-06-01'})], 'MAIN');assert.equal(unknown.pickups[0].hours,null);
});
test('duplicate lookup hydrates and verifies exact customer, status and BLNUM',async()=>{
 const calls=[];const matches=await availableBlnumMatches(async p=>{calls.push(p);return p.startsWith('/orders/search?')?[{id:'0820001'},{id:'0820002'}]:{id:p.split('/').pop(),company_id:'TMS',customer_id:'BUNGOMNE',status:p.endsWith('1')?'A':'D',blnum:'D1085 90 BALES',revenue_code_id:'MAIN'}},'D1085 90 BALES');assert.deepEqual(matches.map(m=>m.id),['0820001']);assert.ok(calls.every(p=>p.startsWith('/orders/')));
});
test('unknown or repeating duplicate search responses never become no-match',async()=>{
 await assert.rejects(availableBlnumMatches(async()=>({rows:[],truncated:true}),'D1085 90 BALES'),/incomplete/);
 assert.deepEqual(await availableBlnumMatches(async()=>null,'D1085 90 BALES'),[]);
 await assert.rejects(availableBlnumMatches(async p=>p.startsWith('/orders/search?')?Array(5).fill({id:'0820001'}):{id:'0820001',company_id:'TMS',customer_id:'BUNGOMNE',status:'A',blnum:'D1085 90 BALES'},'D1085 90 BALES'),/did not advance/);
 await assert.rejects(availableBlnumMatches(async()=>[],'invalid'),/Invalid BLNUM/);
});

 test('SCM delivery selection retains Bunge default and rejects arbitrary destinations',()=>{
 const {deliveryCode}=load('lib/bunge/destinations.ts');
 assert.equal(deliveryCode(null),'SAVAGAG2');assert.equal(deliveryCode('SCMDDETX'),'SCMDDETX');assert.equal(deliveryCode('SUPPSAG2'),'SUPPSAG2');assert.equal(deliveryCode('SUPPBAT1'),'SUPPBAT1');for(const code of ['SAVWHSE','SUPPRIG2','HOUWHSE'])assert.throws(()=>deliveryCode(code),/SCM delivery/);assert.throws(()=>deliveryCode('RANDOM'),/SCM delivery/);
 const [p]=buildPreview([line()],locations,[schedule()],'MAIN','SCMDDETX');assert.equal(p.destination,'SCMDDETX');assert.equal(p.customerId,'BUNGOMNE');assert.equal(p.revenue,'MAIN');
 });
