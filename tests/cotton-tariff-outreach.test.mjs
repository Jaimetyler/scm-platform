import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const mod={exports:{}};
new Function('exports','module',ts.transpileModule(readFileSync('lib/cotton-locations/outreach.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod);
const {outreachUpdate,tariffType}=mod.exports;
const id='11111111-1111-4111-8111-111111111111';
const input={locationId:id,version:0,status:'requested',owner:'Hope',contact_name:'Warehouse office',contact_email:'',contact_phone:'',notes:'Requested written tariff',last_contact:'2026-11-03',next_follow_up:'2026-11-06',effective_date:null,priority:true};
test('rejects unauthorized review, invalid dates and unsafe upload formats',()=>{
 assert.throws(()=>outreachUpdate({...input,status:'reviewed'},false),/administrator/);
 assert.throws(()=>outreachUpdate({...input,last_contact:'2026-02-31'},true),/valid date/);
 assert.equal(outreachUpdate(input,false).owner,'');
 assert.equal(tariffType(Buffer.from('<html>not a tariff</html>')),null);
 assert.equal(tariffType(Buffer.from('%PDF-1.7')).type,'application/pdf');
});
test('migration enforces receipt, review, CAS, audit and private access',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table cotton_location_master(id uuid primary key,mcleod_code text,name text,state text);
 create table cotton_location_schedules(location_id uuid,open_time time);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 insert into cotton_location_master values('${id}','TEST','Test Warehouse','GA');`);
 await db.exec(readFileSync('supabase/migrations/20261104000001_cotton_tariff_outreach.sql','utf8'));
 const save=async(version,changes,admin=false)=>db.query('select save_cotton_tariff_outreach($1,$2,$3::jsonb,$4,$5)',[id,version,JSON.stringify(changes),'test staff',admin]);
 await assert.rejects(save(0,{...input,status:'received'}),/Upload the tariff/);
 await save(0,input);
 await assert.rejects(save(0,input),/Refresh/);
 const doc='22222222-2222-4222-8222-222222222222';
 await db.query('select record_cotton_tariff_document($1,$2,$3,$4,$5)',[doc,id,`${id}/${doc}.pdf`,'tariff.pdf','test staff']);
 assert.equal((await db.query('select status from cotton_tariff_outreach')).rows[0].status,'received');
 await assert.rejects(save(2,{...input,status:'reviewed',effective_date:'2026-01-01'}),/administrator/);
 await assert.rejects(save(2,{...input,status:'reviewed'},true),/effective date/);
 await save(2,{...input,status:'reviewed',effective_date:'2026-01-01'},true);
 assert.equal((await db.query('select count(*)::int as n from cotton_tariff_outreach_events')).rows[0].n,4);
 const doc2='33333333-3333-4333-8333-333333333333';
 await db.query('select record_cotton_tariff_document($1,$2,$3,$4,$5)',[doc2,id,`${id}/${doc2}.pdf`,'revised.pdf','test staff']);
 assert.equal((await db.query('select status from cotton_tariff_outreach')).rows[0].status,'received');
 assert.equal((await db.query("select public from storage.buckets where id='cotton-tariffs'")).rows[0].public,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_table_privilege('${role}','cotton_tariff_outreach','SELECT') as allowed`)).rows[0].allowed,false);
 }finally{await db.close()}
});

test('existing source inventory separates exact coverage from unresolved scans and conflicting codes',()=>{
 const mod={exports:{}};new Function('exports','module',ts.transpileModule(readFileSync('lib/cotton-locations/existing-tariffs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod);
 const {existingTariffs,tariffsForLocation}=mod.exports;
 assert.equal(existingTariffs.length,15);
 assert.equal(tariffsForLocation('LOCKLOTX')[0].effectiveDate,'2026-09-01');
 assert.equal(tariffsForLocation('GLASGATX')[0].filename,'Glasscock County Co-op Tariff 2026.docx');
 assert.equal(tariffsForLocation('FARMLUT2').length,0);
 assert.equal(tariffsForLocation('FARMLUT5').length,0);
 assert.equal(tariffsForLocation('PANHQUTX').length,0);
 assert.equal(tariffsForLocation('TAYLTATX').length,1);
 assert.equal(existingTariffs.filter(t=>!t.codes.length).length,6);
});
