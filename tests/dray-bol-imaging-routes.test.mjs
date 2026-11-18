import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';const require=createRequire(import.meta.url);
function setup({timeout=false,duplicate=false,storageFailure=false,customerId='OLAMRITX',receipts=[],images=[]}={}){
 const runId='22222222-2222-4222-8222-222222222222',rowId='11111111-1111-4111-8111-111111111111';let uploads=0,claims=0,saved=null,uploadedType=null;const item={order_id:rowId,order:{order_id:'0826838',profile:{id:'DRAY-SAV-SAVWHSE'},invoice:{customerId}}};
 const client={types:async()=>[{id:'1',description:'Bill of Lading'}],images:async()=>images,upload:async(id,type,bytes)=>{assert.deepEqual(bytes,new Uint8Array([9,8,7]));uploads++;uploadedType=type;if(timeout)throw Error('timeout');return 'batch123'}};
 const db={from:table=>({select:()=>({eq:()=>({order:async()=>({data:receipts})})}),insert:()=>({select:()=>({single:async()=>{claims++;return duplicate?{error:{code:'23505'}}:{data:{id:'claim1'}}}})}),update:values=>({eq:async()=>{saved=values;return {}}})})};
 const local=n=>n==='@/lib/auth/guard'?{withStaffAccess:f=>f,staffActor:()=> 'staff'}:n==='@/lib/auth/session'?{staffDatabase:()=>db}:n==='@/lib/dray/server'?{readRun:async()=>({items:[item]}),vendor:()=>({read:async()=>({id:'0826838'})})}:n==='@/lib/dray-bols/eligible'?{bolEligible:i=>!!i}:n==='@/lib/dray-bols/plan'?{bolPlan:()=>({orderId:'0826838'})}:n==='@/lib/dray-bols/storage'?{persistBol:async()=>{if(storageFailure)throw Error('Storage failed');return {bytes:new Uint8Array([9,8,7]),document:{id:'doc1',pdf_hash:'a'.repeat(64)}}}}:n==='@/lib/dray-bols/imaging'?{imagingClient:()=>client,receiptVisible:()=>false}:require(n);
 const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync('app/api/dray-import/bols/imaging/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(local,m,m.exports);
 return {send:change=>m.exports.POST({json:async()=>({runId,rowId,action:'send',confirmed:true,documentTypeId:'1',...change})}),stats:()=>({uploads,claims,saved,uploadedType})};
}
test('imaging send requires saved run membership, valid type, explicit confirmation and both write flags',async()=>{const a=process.env.DRAY_IMPORT_WRITES_ENABLED,b=process.env.MCLEOD_SYNC_ENABLED;try{process.env.DRAY_IMPORT_WRITES_ENABLED='true';process.env.MCLEOD_SYNC_ENABLED='true';for(const change of [{rowId:'33333333-3333-4333-8333-333333333333'},{confirmed:false},{documentTypeId:'bad'}]){const t=setup();assert.equal((await t.send(change)).status,400);assert.equal(t.stats().uploads,0);}process.env.MCLEOD_SYNC_ENABLED='false';const t=setup();assert.equal((await t.send({})).status,400);assert.equal(t.stats().claims,0);}finally{process.env.DRAY_IMPORT_WRITES_ENABLED=a;process.env.MCLEOD_SYNC_ENABLED=b;}});
test('timeout remains uncertain, staged receipts are not called indexed, duplicate claims never upload',async()=>{const a=process.env.DRAY_IMPORT_WRITES_ENABLED,b=process.env.MCLEOD_SYNC_ENABLED;try{process.env.DRAY_IMPORT_WRITES_ENABLED='true';process.env.MCLEOD_SYNC_ENABLED='true';const timeout=setup({timeout:true}),r=await timeout.send({});assert.equal((await r.json()).status,'uncertain');assert.equal(timeout.stats().uploads,1);assert.equal(timeout.stats().saved.status,'uncertain');const staged=setup();assert.equal((await (await staged.send({})).json()).status,'staged');const failStorage=setup({storageFailure:true});assert.equal((await failStorage.send({})).status,400);assert.equal(failStorage.stats().uploads,0);assert.equal(failStorage.stats().claims,0);const duplicate=setup({duplicate:true});assert.equal((await duplicate.send({})).status,400);assert.equal(duplicate.stats().uploads,0);}finally{process.env.DRAY_IMPORT_WRITES_ENABLED=a;process.env.MCLEOD_SYNC_ENABLED=b;}});

test('Savannah batch sends Olam BOLs and skips existing or uncertain images', async () => {
 const flags = ['DRAY_IMPORT_WRITES_ENABLED', 'MCLEOD_SYNC_ENABLED'];
 const previous = flags.map(flag => process.env[flag]);
 try {
  for (const flag of flags) process.env[flag] = 'true';
  const action = {action:'send-savannah-bol',documentTypeId:undefined};
  const fresh = setup();
  assert.equal((await (await fresh.send(action)).json()).status, 'staged');
  assert.equal(fresh.stats().uploads, 1);
  assert.equal(fresh.stats().uploadedType, '1');
  const indexed = setup({images:[{documentTypeId:'1'}]});
  assert.equal((await (await indexed.send(action)).json()).status, 'already-indexed');
  assert.equal(indexed.stats().claims, 0);
  const pending = setup({receipts:[{document_type:'01',status:'uncertain'}]});
  assert.equal((await (await pending.send(action)).json()).status, 'uncertain');
  assert.equal(pending.stats().claims, 0);
  const bunge = setup({customerId:'BUNGOMNE'});
  assert.equal((await bunge.send(action)).status, 400);
  assert.equal(bunge.stats().claims, 0);
 } finally {
  flags.forEach((flag, index) => {
   if (previous[index] === undefined) delete process.env[flag];
   else process.env[flag] = previous[index];
  });
 }
});
