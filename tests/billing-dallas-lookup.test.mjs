import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync('lib/billing/dallas-order-lookup.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
const {findDallasBillingOrders, isDallasBillingOrder} = exports;
const order = (id, location='SCMDDETX', extra={}) => ({id,blnum:'100',order_type_id:'ECOTTON',revenue_code_id:'DLOCA',stops:[{stop_type:'PU',location_id:location},{stop_type:'SO',location_id:location}],...extra});
test('same reference across Dallas warehouses selects only the requested warehouse and deduplicates IDs', async()=>{
 const calls=[]; const found=await findDallasBillingOrders(async path=>{calls.push(path);if(path.startsWith('/orders/search?'))return [{id:'1'},{id:'2'},{id:'1'}];return path.endsWith('/1')?order('1'):order('2','SCMDDATX');},'100','SCMDDETX');
 assert.deepEqual(found.map(o=>o.id),['1']); assert.equal(calls.filter(p=>p==='/orders/1').length,1);
 const q=new URLSearchParams(calls[0].split('?')[1]);assert.equal(q.get('orders.order_type_id'),'ECOTTON');assert.equal(q.get('orders.revenue_code_id'),'DLOCA');
});
test('rejects wrong reference/type/revenue, mixed stops and additional stops',()=>{
 for(const extra of [{blnum:'1000'},{order_type_id:'OTHER'},{revenue_code_id:'MAIN'},{stops:[{stop_type:'PU',location_id:'SCMDDETX'},{stop_type:'SO',location_id:'SCMDDATX'}]},{stops:[...order('1').stops,{stop_type:'SO',location_id:'SCMDDETX'}]}]) assert.equal(isDallasBillingOrder(order('1','SCMDDETX',extra),'100','SCMDDETX'),false);
});
test('missing warehouse, malformed response, missing location error and full repeated pages fail closed',async()=>{
 await assert.rejects(findDallasBillingOrders(async()=>[],'100',''),/Select/);
 await assert.rejects(findDallasBillingOrders(async()=>({unexpected:[]}), '100','SCMDDETX'),/unrecognized/);
 await assert.rejects(findDallasBillingOrders(async()=>{throw Error('SUPPGAGA missing');},'100','SCMDDETX'),/SUPPGAGA/);
 await assert.rejects(findDallasBillingOrders(async p=>p.startsWith('/orders/search?')?Array.from({length:5},(_,i)=>({id:String(i)})):order(p.split('/').at(-1)),'100','SCMDDETX'),/incomplete/);
});
test('does not choose newest/status when two orders share a warehouse',async()=>{
 const found=await findDallasBillingOrders(async p=>p.startsWith('/orders/search?')?[{id:'1'},{id:'2'}]:order(p.split('/').at(-1)), '100','SCMDDETX');assert.equal(found.length,2);
});
