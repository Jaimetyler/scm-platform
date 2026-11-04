import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);const m={exports:{}};let renders=0;new Function('require','module','exports',ts.transpileModule(readFileSync('lib/dray-bols/storage.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n==='./pdf.ts'?{createBol:async()=>{renders++;return new Uint8Array([37,80,68,70,45,49])},filename:()=> 'BOOK/MARK_CONTAINER_0826838.pdf'}:require(n),m,m.exports);
const {persistBol,savedBol}=m.exports;
function fixture({failUpload=false,corrupt=false}={}){
 let doc=null,uploads=0;const objects=new Map(),steps=[];
 const query={eq:()=>query,maybeSingle:async()=>({data:doc})};
 const bucket={
  upload:async(path,bytes,opts)=>{assert.equal(opts.upsert,false);assert.equal(opts.contentType,'application/pdf');steps.push('upload');uploads++;if(failUpload)return {error:{statusCode:'500'}};objects.set(path,bytes);return {};},
  download:async path=>{steps.push('download');return {data:new Blob([corrupt?new Uint8Array([0]):objects.get(path)])};}
 };
 const db={
  from:()=>({select:()=>query,insert:value=>({select:()=>({single:async()=>{steps.push('record');doc={id:'document1',...value};return {data:doc};}})})}),
  storage:{from:name=>{assert.equal(name,'savannah-dray-bols');return bucket;}}
 };
 return {db,steps,uploads:()=>uploads};
}

const item={order_id:'11111111-1111-4111-8111-111111111111',bol_bales:85,order:{order_id:'0826838',source_hash:'source'}},plan={orderId:'0826838',booking:'BOOK'};
test('private BOL storage verifies bytes before record, reuses exact saved file and detects corruption',async()=>{const f=fixture();const a=await persistBol(f.db,item,plan,'staff');assert.deepEqual(f.steps,['upload','download','record']);assert.equal(a.document.actor,'staff');const rendered=renders;const b=await persistBol(f.db,item,plan,'another staff');assert.deepEqual(a.bytes,b.bytes);assert.equal(renders,rendered);assert.equal(f.uploads(),1);assert.deepEqual((await savedBol(f.db,item)).bytes,a.bytes);await assert.rejects(persistBol(f.db,item,{...plan,booking:'changed'},'staff'),/differ/);const broken=fixture({corrupt:true});await assert.rejects(persistBol(broken.db,item,plan,'staff'),/verification failed/);assert.ok(!broken.steps.includes('record'));});
test('storage failures do not record a successful document',async()=>{const f=fixture({failUpload:true});await assert.rejects(persistBol(f.db,item,plan,'staff'),/could not be saved/);assert.ok(!f.steps.includes('record'));});
test('private bucket, document grants, immutable identity and imaging link are enforced',async()=>{const db=new PGlite();try{await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table dray_import_orders(id uuid primary key);create table dray_bol_images(id uuid primary key);`);await db.exec(readFileSync('supabase/migrations/20261104035224_dray_bol_private_documents.sql','utf8'));const bucket=(await db.query('select * from storage.buckets')).rows[0];assert.equal(bucket.public,false);assert.deepEqual(bucket.allowed_mime_types,['application/pdf']);assert.equal((await db.query("select has_table_privilege('authenticated','dray_bol_documents','SELECT') as allowed")).rows[0].allowed,false);assert.equal((await db.query("select has_table_privilege('service_role','dray_bol_documents','UPDATE') as allowed")).rows[0].allowed,false);assert.equal((await db.query("select relrowsecurity as rls from pg_class where oid='dray_bol_documents'::regclass")).rows[0].rls,true);}finally{await db.close()}});
test('saved download checks run membership and needs no McLeod connection',async()=>{
 let reads=0;const rowId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222',route={exports:{}};
 const local=n=>n==='@/lib/auth/guard'?{withStaffAccess:f=>f}:n==='@/lib/auth/session'?{staffDatabase:()=>({})}:n==='@/lib/dray/server'?{readRun:async()=>({items:[{order_id:rowId}]}),vendor:()=>{throw Error('Must not contact McLeod');}}:n==='@/lib/dray-bols/eligible'?{bolEligible:i=>!!i}:n==='@/lib/dray-bols/storage'?{savedBol:async()=>{reads++;return {document:{filename:'BOOK/BOL.pdf'},bytes:new Uint8Array([37,80,68,70])};}}:n.startsWith('@/lib/dray-bols/')?{}:require(n);
 new Function('require','module','exports',ts.transpileModule(readFileSync('app/api/dray-import/bols/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(local,route,route.exports);
 const get=id=>route.exports.GET({nextUrl:new URL('https://scm.test/api/dray-import/bols?run='+runId+'&row='+id)});
 assert.equal((await get('33333333-3333-4333-8333-333333333333')).status,400);assert.equal(reads,0);
 const response=await get(rowId);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(new Uint8Array(await response.arrayBuffer()).length,4);assert.equal(reads,1);
});
