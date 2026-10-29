import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url), cache=new Map();
function load(file){const path=resolve(file);if(cache.has(path))return cache.get(path).exports;const mod={exports:{}};cache.set(path,mod);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(resolve(dirname(path),n)):require(n),mod,mod.exports);return mod.exports;}
const {PROFILES}=load('lib/ecotton/model.ts');
const {buildPayload}=load('lib/ecotton/mcleod.ts');
const {buildDeliveryPlan,deliverInvoice,reconcileDelivery}=load('lib/ecotton/delivery.ts');
function fixture(){
 const row={id:'row',status:'verified',order_id:'0828170',profile:PROFILES[0],invoice:{reference:'BOL',mark:'MARK',invoiceDate:'2026-10-20',customerId:'CUSTOMER',cents:1234,charges:[{code:'TEST',description:'Test',units:1,cents:1234}]}};
 const o={...buildPayload(row.invoice,row.profile),id:row.order_id,total_charge:12.34,curr_movement_id:'649341',ready_to_bill:false};
 o.stops.forEach((s,i)=>Object.assign(s,{id:'stop'+i,movement_id:'649341',order_id:row.order_id}));
 Object.assign(o.movements[0],{id:'649341',status:'A',origin_stop_id:'stop0',dest_stop_id:'stop1'});
 let writes=[], failAt=0,claimed=false;
 const store={claim:async(id,from,to,note)=>{if(claimed||row.status!==from)return null;claimed=true;Object.assign(row,{status:to,note});return row;},finish:async(r,status,id,note)=>Object.assign(row,{status,order_id:id,note})};
 const vendor={read:async()=>structuredClone(o),write:async(path,payload)=>{writes.push({path,payload});if(writes.length===failAt)throw Error('uncertain network');if(path==='/stop/update')Object.assign(o.stops.find(s=>s.id===payload.id),payload);if(path==='/movement/update')Object.assign(o.movements[0],payload);if(path==='/orders/updateRow')Object.assign(o,payload);}};
 return {row,o,store,vendor,writes,fail:(n)=>failAt=n};
}
test('delivery copies stored schedules exactly; updates only whitelisted rows and preserves charges/pay',async()=>{
 const f=fixture(),before=structuredClone(f.o),plan=buildDeliveryPlan(f.o,f.row);
 assert.equal(plan.stops[0].arrival,'20261020000000-0400');
 await deliverInvoice(f.row,f.store,f.vendor,plan);
 assert.equal(f.row.status,'delivered');assert.equal(f.writes.length,4);
 assert.equal(f.o.ready_to_bill,true);assert.equal(f.o.movements[0].brokerage_status,'FINISHED');
 assert.deepEqual(f.o.otherCharges,before.otherCharges);assert.equal(f.o.movements[0].override_pay_rate,0);
 for(const s of f.o.stops){assert.equal(s.actual_arrival,s.sched_arrive_early);assert.equal(s.actual_departure,s.sched_arrive_late);}
 assert.deepEqual(Object.keys(f.writes[3].payload).sort(),['__type','company_id','id','ready_to_bill','status']);
 await deliverInvoice(f.row,f.store,f.vendor,plan);assert.equal(f.writes.length,4);
});
test('stale schedule or identity, missing dates, mismatched movement, conflicting actuals block all writes',async()=>{
 for(const mutate of [f=>f.o.stops[0].sched_arrive_late=null,f=>f.o.stops[0].actual_arrival='20261020010000-0400',f=>f.o.movements[0].dest_stop_id='wrong',f=>f.o.id='wrong',f=>f.o.otherCharges[0].amount=99,f=>f.o.stops[0].sched_arrive_late='20260230000000-0400',f=>f.o.xferred2billing=true]){
  const f=fixture();mutate(f);assert.throws(()=>buildDeliveryPlan(f.o,f.row));assert.equal(f.writes.length,0);
 }
 const f=fixture(),plan=buildDeliveryPlan(f.o,f.row);f.o.stops[0].sched_arrive_late='20261020000100-0400';
 await assert.rejects(deliverInvoice(f.row,f.store,f.vendor,plan));assert.equal(f.writes.length,0);
});
test('concurrent requests issue a single set of delivery writes',async()=>{
 const f=fixture(),plan=buildDeliveryPlan(f.o,f.row);
 const result=await Promise.allSettled([deliverInvoice(f.row,f.store,f.vendor,plan),deliverInvoice(f.row,f.store,f.vendor,plan)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.writes.length,4);
});
test('partial or uncertain writes remain fenced; reconciliation is read-only',async()=>{
 for(let step=1;step<=4;step++){
  const f=fixture(),plan=buildDeliveryPlan(f.o,f.row);f.fail(step);
  await assert.rejects(deliverInvoice(f.row,f.store,f.vendor,plan));assert.equal(f.row.status,'delivery_uncertain');assert.deepEqual(JSON.parse(f.row.note).deliveryPlan,plan);
  await assert.rejects(deliverInvoice(f.row,f.store,f.vendor,plan));
  await reconcileDelivery(f.row,f.store,f.vendor);assert.equal(f.writes.length,step);assert.equal(f.row.status,'delivery_uncertain');
 }
});
test('lost successful response reconciles without repeating delivery or changing snapshot',async()=>{
 const f=fixture(),plan=buildDeliveryPlan(f.o,f.row);await deliverInvoice(f.row,f.store,f.vendor,plan);
 f.row.status='delivery_uncertain';await reconcileDelivery(f.row,f.store,f.vendor);assert.equal(f.row.status,'delivered');assert.equal(f.writes.length,4);
 f.row.status='delivery_uncertain';f.o.stops[0].sched_arrive_early='20261020000100-0400';await reconcileDelivery(f.row,f.store,f.vendor);assert.equal(f.row.status,'delivery_uncertain');assert.equal(f.writes.length,4);
});
test('delivery migration preserves ledger and audit and fences concurrent SQL claims',async()=>{
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(readFileSync('supabase/migrations/20261027190536_ecotton_import_ledger.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261028122734_ecotton_delivery.sql','utf8'));
 const r=await db.query(`insert into ecotton_import_orders(terminal,location,reference,invoice,profile,source_hash,status,order_id) values('HOU','HOUWHSE','BOL','{}','{}','hash','verified','0828170') returning id`);const id=r.rows[0].id;
 const claim=`select * from transition_ecotton_import($1,0,'verified','delivering','0828170','snapshot','test')`;
 assert.equal((await db.query(claim,[id])).rows.length,1);assert.equal((await db.query(claim,[id])).rows.length,0);
 await db.query(`select * from transition_ecotton_import($1,1,'delivering','delivery_uncertain','0828170','snapshot','test')`,[id]);
 await assert.rejects(db.query(`select * from transition_ecotton_import($1,2,'delivery_uncertain','verified','0828170','bad','test')`,[id]));
 await db.query(`select * from transition_ecotton_import($1,2,'delivery_uncertain','delivered','0828170','verified','test')`,[id]);
 assert.equal((await db.query('select * from ecotton_import_events')).rows.length,3);await db.close();
});
