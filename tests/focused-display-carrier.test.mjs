import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichDisplayCarriers, lookupDisplayCarrier } from '../lib/inbound/checkin/display-carrier.ts';
process.env.MCLEOD_BASE_URL='https://mcleod.invalid.test';process.env.MCLEOD_AUTH_TOKEN='synthetic-test-token';
const response=(id)=>new Response(JSON.stringify({id,curr_movement_id:'M1',movements:[{id:'M1',carrier_id:'SCMIRIGA',carrier:{name:'Synthetic carrier'}}]}));

test('display enrichment deduplicates names/codes without exposing or using order status',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response('DEDUP');});
  const rows=await enrichDisplayCarriers([{id:'1',matched_order_id:'DEDUP',trucking_company:null},{id:'2',matched_order_id:'DEDUP',trucking_company:'Stored company'}],true);
  assert.equal(calls,1);assert.equal(rows[0].trucking_company,'Synthetic carrier');assert.equal(rows[1].trucking_company,'Stored company');assert.equal(rows[0].scm_carrier,true);
  await enrichDisplayCarriers([{matched_order_id:'DEDUP'}],true);assert.equal(calls,1);
  assert.deepEqual(Object.keys(await lookupDisplayCarrier('DEDUP')).sort(),['carrierCode','carrierName','scmCarrier']);
});

test('negative cache prevents retry storms; credential scope changes invalidate display values',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('synthetic outage');});
  assert.equal((await lookupDisplayCarrier('NEGATIVE')).carrierName,null);await lookupDisplayCarrier('NEGATIVE');assert.equal(calls,1);
  process.env.MCLEOD_AUTH_TOKEN='synthetic-rotated-token';await lookupDisplayCarrier('NEGATIVE');assert.equal(calls,2);
});

test('global concurrency is bounded and optional data does not block the operational list',async t=>{
  const finish=[];let calls=0;
  t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(resolve=>finish.push(()=>resolve(response('SLOW'))));});
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=enrichDisplayCarriers(Array.from({length:100},(_,id)=>({id,matched_order_id:`SLOW${id}`})),true);
  assert.equal(calls,4);t.mock.timers.tick(150);
  const rows=await pending;assert.equal(rows.length,100);
  finish.forEach(resolve=>resolve());for(let i=0;i<20;i++) await Promise.resolve();
});

test('old display entries are evicted rather than accumulating indefinitely',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response('BOUND');});
  for(let id=0;id<260;id++) await lookupDisplayCarrier(`BOUND${id}`);
  assert.equal(calls,260);await lookupDisplayCarrier('BOUND0');assert.equal(calls,261);
});

test('the external deadline remains active while the response body is stalled',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(AbortSignal,'timeout',(ms)=>{
  const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;
 });
 let signal;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  signal=init.signal;
  return new Response(new ReadableStream({start(controller){
   signal.addEventListener('abort',()=>controller.error(new DOMException('Body timeout','AbortError')),{once:true});
  }}));
 });
 const pending=lookupDisplayCarrier('STALLED_BODY');
 for(let i=0;i<10;i++) await Promise.resolve();
 t.mock.timers.tick(2000);
 const result=await pending;
 assert.equal(signal.aborted,true);assert.equal(result.carrierName,null);
});

test('failed first rows do not starve later rows of a large page',async t=>{
 const seen=new Set();t.mock.method(globalThis,'fetch',async url=>{seen.add(String(url));throw new Error('synthetic outage');});
 const rows=Array.from({length:100},(_,id)=>({id,matched_order_id:`FAIR${id}`}));
 for(let poll=0;poll<30;poll++) await enrichDisplayCarriers(rows,true);
 assert.equal(seen.size,100);
});
