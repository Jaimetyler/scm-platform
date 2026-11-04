import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';
const require=createRequire(import.meta.url);const cache=new Map();
function load(path){if(cache.has(path))return cache.get(path);const mod={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n==='./duplicate-window'?load('lib/bunge/duplicate-window.ts'):n==='@/lib/mcleod/inbound/search-response'?load('lib/mcleod/inbound/search-response.ts'):require(n),mod,mod.exports);cache.set(path,mod.exports);return mod.exports;}
const {parseDispatch,buildPreview}=load('lib/bunge/preview.ts');const {nonVoidBlnumMatches}=load('lib/bunge/duplicates.ts');
const loc=(id,code,prev)=>({id,mcleod_code:code,prev_code:prev,name:code,address:'Street',city:'Town',state:'GA',timezone:'America/New_York'});
const locations=[loc('l1','FUNSMOG3','266405'),loc('l2','BCTGMOGA','304495'),loc('dest','SAVAGAG2',null)];
const line=(x={})=>({sheet:'Sheet1',row:1,mark:'D1085',so:'2511158',bales:30,weight:null,warehouse:'FUNSTON GIN CO',warehouseCode:'266405',address:[],rtl:'2026-04-30',...x});
const schedule=(x={})=>({location_id:'l1',weekday:4,open_time:'08:00',close_time:'15:00',checkin_cutoff:null,verified:false,appointment_required:null,effective_from:null,effective_to:null,created_at:'2026-11-03T10:00:00Z',source_reference:'History',...x});
const csv=rows=>Buffer.from(rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n'));
const headers=['Mark','SO','Sale','Ext.','Bales','','Weight','','','Warehouse','','','Flatbeds','Due','Load (RTL)'];
const row=(x={})=>{const r=Array(15).fill('');Object.assign(r,{0:'D1085',1:'2511158',4:30,8:'266405',9:'FUNSTON GIN CO',14:'04/30/26',...x});return r};
test('groups SO plus mark, sums two pickups, builds BLNUM and preserves date/row provenance',()=>{
 const [p]=buildPreview([line(),line({row:2,bales:60,warehouse:'BCT',warehouseCode:'304495'})],locations,[schedule()], 'MAIN');
 assert.equal(p.blnum,'D1085 90 BALES',['2026-04-30']);assert.equal(p.pickups.length,2);assert.equal(p.customerId,'BUNGOMNE');assert.equal(p.destination,'SAVAGAG2');assert.deepEqual(p.pickups.map(s=>s.bales),[30,60]);assert.match(p.pickups[0].issues.join(),/unverified/);
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
test('duplicate lookup includes available, delivered and in-progress orders but excludes void',async()=>{
 const calls=[];const states={'0820001':'A','0820002':'D','0820003':'P','0820004':'V'};
 const matches=await nonVoidBlnumMatches(async path=>{calls.push(path);const id=path.split('/').pop();return path.startsWith('/orders/search?')?Object.keys(states).map(id=>({id})):{id,company_id:'TMS',customer_id:'BUNGOMNE',status:states[id],stops:states[id]==='V'?undefined:[{stop_type:'PU',sched_arrive_early:'20260430080000-0400'}],blnum:'D1085 90 BALES',revenue_code_id:'MAIN'}},'D1085 90 BALES',['2026-04-30']);
 assert.deepEqual(matches.map(m=>m.id),['0820001','0820002','0820003']);assert.deepEqual(matches.map(m=>m.status),['A','D','P']);
 assert.ok(calls.every(p=>p.startsWith('/orders/')));assert.equal(new URL('https://example.test'+calls[0]).searchParams.has('orders.status'),false);
});
test('unknown or repeating duplicate search responses never become no-match',async()=>{
 await assert.rejects(nonVoidBlnumMatches(async()=>({rows:[],truncated:true}),'D1085 90 BALES',['2026-04-30']),/incomplete/);
 assert.deepEqual(await nonVoidBlnumMatches(async()=>null,'D1085 90 BALES',['2026-04-30']),[]);
 await assert.rejects(nonVoidBlnumMatches(async p=>p.startsWith('/orders/search?')?Array(5).fill({id:'0820001'}):{id:'0820001',company_id:'TMS',customer_id:'BUNGOMNE',status:'A',stops:[{stop_type:'PU',sched_arrive_early:'20260430080000-0400'}],blnum:'D1085 90 BALES'},'D1085 90 BALES',['2026-04-30']),/did not advance/);
 await assert.rejects(nonVoidBlnumMatches(async()=>[],'invalid',['2026-04-30']),/Invalid BLNUM/);
});

 test('SCM delivery selection retains Bunge default and rejects arbitrary destinations',()=>{
 const {deliveryCode}=load('lib/bunge/destinations.ts');
 assert.equal(deliveryCode(null),'SAVAGAG2');assert.equal(deliveryCode('SCMDDETX'),'SCMDDETX');assert.equal(deliveryCode('SUPPSAG2'),'SUPPSAG2');assert.equal(deliveryCode('SUPPBAT1'),'SUPPBAT1');for(const code of ['SAVWHSE','SUPPRIG2','HOUWHSE'])assert.throws(()=>deliveryCode(code),/SCM delivery/);assert.throws(()=>deliveryCode('RANDOM'),/SCM delivery/);
 const [p]=buildPreview([line()],locations,[schedule()],'MAIN','SCMDDETX');assert.equal(p.destination,'SCMDDETX');assert.equal(p.customerId,'BUNGOMNE');assert.equal(p.revenue,'MAIN');
 });

test('pickup month windows use calendar months, clamp month ends and cover both pickup dates',()=>{
 const {pickupMonthRanges}=load('lib/bunge/duplicate-window.ts');
 assert.deepEqual(pickupMonthRanges(['2026-03-31']),[{from:'2026-02-28',to:'2026-04-30'}]);
 assert.deepEqual(pickupMonthRanges(['2024-03-31']),[{from:'2024-02-29',to:'2024-04-30'}]);
 assert.deepEqual(pickupMonthRanges(['2026-04-30','2026-05-01']),[{from:'2026-03-30',to:'2026-06-01'}]);
 assert.throws(()=>pickupMonthRanges([null]),/valid scheduled pickup/);assert.throws(()=>pickupMonthRanges(['2026-02-31']),/valid scheduled pickup/);
});
test('exact BLNUM matches are bounded by pickup schedule, inclusive of both endpoints',async()=>{
 const dates=['20260330000000-0400','20260530235959-0400','20260531000000-0400','20260101000000-0500'];
 const result=await nonVoidBlnumMatches(async path=>path.startsWith('/orders/search?')?dates.map((_,i)=>({id:'082000'+i})):{id:path.split('/').pop(),company_id:'TMS',customer_id:'BUNGOMNE',status:'A',blnum:'D1085 90 BALES',ordered_date:'20260430',stops:[{stop_type:'PU',sched_arrive_early:dates[Number(path.slice(-1))]},{stop_type:'SO',sched_arrive_early:'20260430000000-0400'}]},'D1085 90 BALES',['2026-04-30']);
 assert.deepEqual(result.map(r=>r.id),['0820000','0820001']);
});
test('missing existing pickup schedules remain incomplete, not a no-match',async()=>{
 await assert.rejects(nonVoidBlnumMatches(async path=>path.startsWith('/orders/search?')?[{id:'0820000'}]:{id:'0820000',company_id:'TMS',customer_id:'BUNGOMNE',status:'A',blnum:'D1085 90 BALES',stops:[{stop_type:'PU'}]},'D1085 90 BALES',['2026-04-30']),/scheduled pickup date/);
 let calls=0;await assert.rejects(nonVoidBlnumMatches(async()=>{calls++;return []},'D1085 90 BALES',[null]),/valid scheduled pickup/);assert.equal(calls,0);
});

test('Dallas B/C and Savannah BALES suffixes are equivalent without changing mark or count',async()=>{
 const queries=[],reads=[];
 const result=await nonVoidBlnumMatches(async path=>{
 if(path.startsWith('/orders/search?')){const ref=new URL('https://example.test'+path).searchParams.get('orders.blnum');queries.push(ref);return ref.endsWith('B/C')?[{id:'0820001'},{id:'0820002'},{id:'0820003'}]:[{id:'0820001'}]}
 reads.push(path);const id=path.split('/').pop();return {id,company_id:'TMS',customer_id:'BUNGOMNE',status:'D',blnum:id==='0820001'?'D1085 90 B/C':id==='0820002'?'D1085 89 B/C':'OTHER 90 B/C',stops:[{stop_type:'PU',sched_arrive_early:'20260430080000-0400'}]};
 },'D1085 90 BALES',['2026-04-30']);
 assert.deepEqual(queries,['D1085 90 BALES','D1085 90 B/C']);assert.deepEqual(result.map(r=>r.id),['0820001']);assert.equal(reads.filter(p=>p.endsWith('0820001')).length,1);
 const {canonicalBlnum}=load('lib/bunge/duplicates.ts');assert.equal(canonicalBlnum('d1085  90 b / c'),'D1085 90 BALES');assert.equal(canonicalBlnum('D1085 90 BOXES'),null);
});
