import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {PGlite} from '@electric-sql/pglite';
const mod={exports:{}};new Function('exports','module',ts.transpileModule(readFileSync('lib/cotton-locations/equipment.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod);
const {validateEquipment,equipmentNotes}=mod.exports;
const input={accepted_equipment:'van_and_flatbed',fee_basis:'per_bale',fee_amount:1.5,fee_payer:'shipper',conditions:'48 hours notice',source_reference:'Written tariff 2026',effective_date:'2026-09-01',verified:false};
test('equipment collection distinguishes unknown, zero fee, basis, payer and administrator confirmation',()=>{
 assert.equal(validateEquipment(input,false).fee_payer,'shipper');assert.throws(()=>validateEquipment({...input,verified:true},false),/administrator/);
 assert.throws(()=>validateEquipment({...input,fee_amount:null},true),/amount/);assert.throws(()=>validateEquipment({...input,fee_basis:'unknown'},true),/basis/);
 assert.throws(()=>validateEquipment({...input,verified:true,fee_payer:'unknown'},true),/payer/);assert.throws(()=>validateEquipment({...input,effective_date:'2026-02-31'},true),/date/);
 assert.equal(validateEquipment({...input,fee_basis:'none',fee_amount:null},true).fee_amount,0);
});
test('flatbed previews flag van-only/unknown restrictions and keep shipper fees informational',()=>{
 const policy={...input,accepted_equipment:'van_only',verified:false};
 assert.match(equipmentNotes(policy,'flatbed','TX').join(' '),/VAN ONLY/);assert.match(equipmentNotes(undefined,'flatbed','OK').join(' '),/acceptance is unknown/);
 const note=equipmentNotes({...input},'flatbed','TX').join(' ');assert.match(note,/payer: shipper/);assert.match(note,/Not added to carrier pay or order charges/);assert.equal(input.fee_amount,1.5);
 assert.match(equipmentNotes(undefined,'unknown','KS').join(),/Confirm van\/flatbed/);
});
test('equipment saves enforce CAS, admin confirmation, audit and server-only access',async()=>{
 const db=new PGlite();const id='11111111-1111-4111-8111-111111111111';
 try{await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table cotton_location_master(id uuid primary key,mcleod_code text,name text);create table cotton_location_change_events(id bigint generated always as identity,location_id uuid,action text,actor text,before_value jsonb,after_value jsonb,source_reference text);insert into cotton_location_master values('${id}','GLASGATX','Glasscock');`);
 await db.exec(readFileSync('supabase/migrations/20261104023041_cotton_location_equipment.sql','utf8'));
 const initial=(await db.query('select * from cotton_location_equipment')).rows[0];assert.equal(Number(initial.fee_amount),3.42);assert.equal(initial.verified,false);assert.equal(initial.fee_payer,'unknown');
 const save=(version,changes,admin)=>db.query('select save_cotton_equipment($1,$2,$3::jsonb,$4,$5)',[id,version,JSON.stringify(changes),'signed in collector',admin]);
 await assert.rejects(save(0,{...input,verified:true},false),/Administrator/);await save(0,input,false);await assert.rejects(save(0,input,false),/Refresh/);
 await save(1,{...input,verified:true},true);assert.equal((await db.query('select verified from cotton_location_equipment')).rows[0].verified,true);
 assert.equal((await db.query("select count(*)::int as n from cotton_location_change_events where action='equipment_review'")).rows[0].n,2);
 assert.equal((await db.query("select has_table_privilege('authenticated','cotton_location_equipment','select') as allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','save_cotton_equipment(uuid,integer,jsonb,text,boolean)','execute') as allowed")).rows[0].allowed,false);
 }finally{await db.close()}
});
test('regional van-only defaults cover all requested states, future locations and preserve specific policies',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table cotton_location_master(id uuid primary key,mcleod_code text,name text,state text);create table cotton_location_change_events(id bigint generated always as identity,location_id uuid,action text,actor text,before_value jsonb,after_value jsonb,source_reference text);`);
 await db.exec(readFileSync('supabase/migrations/20261104023041_cotton_location_equipment.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261104024606_cotton_van_only_state_defaults.sql','utf8'));
 for(const [i,state] of ['GA','SC','AL','FL','NC','VA','TN','AR','MS','TX','OK','KS','NM'].entries()){
 const id=`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`;
 await db.query('insert into cotton_location_master values($1,$2,$3,$4)',[id,state,'Warehouse',state]);
 const row=(await db.query('select * from cotton_location_equipment where location_id=$1',[id])).rows[0];
 if(i<9){assert.equal(row.accepted_equipment,'van_only');assert.equal(row.verified,false);assert.match(row.source_reference,/operational default/)}else assert.equal(row,undefined);
 }
 const tx='11111111-1111-4111-8111-000000000009';
 await db.query("update cotton_location_master set state='GA' where id=$1",[tx]);assert.equal((await db.query('select accepted_equipment from cotton_location_equipment where location_id=$1',[tx])).rows[0].accepted_equipment,'van_only');
 await db.query("update cotton_location_equipment set accepted_equipment='van_and_flatbed',source_reference='Specific facility exception' where location_id=$1",[tx]);
 await db.query("update cotton_location_master set state='SC' where id=$1",[tx]);assert.equal((await db.query('select accepted_equipment from cotton_location_equipment where location_id=$1',[tx])).rows[0].accepted_equipment,'van_and_flatbed');
 assert.equal((await db.query("select count(*)::int as n from cotton_location_change_events where action='equipment_state_default'")).rows[0].n,10);
 }finally{await db.close()}
});
