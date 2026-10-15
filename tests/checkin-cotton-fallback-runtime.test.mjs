// Embedded PostgreSQL runtime only: no network, credentials, or external database.
// PGlite is single-session; these tests do not establish multi-session concurrency.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const migrations = new URL('../supabase/migrations/', import.meta.url);
test('047 embedded PostgreSQL runtime: migrations, atomic fallback, replay and guards', async t => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && Number(n.slice(0,3)) <= 47).sort()) {
      // pgcrypto's only needed facility here is core gen_random_uuid(), provided by PGlite.
      const sql = readFileSync(new URL(name, migrations), 'utf8').replace('create extension if not exists pgcrypto;', '');
      try { await db.exec(sql); } catch (e) { throw new Error(`${name}: ${e.message}`); }
    }
    const staff = (await db.query(`insert into scm_staff(email,name,role,status,user_id) values('auto@example.test','Fixture','admin','active',gen_random_uuid()) returning *`)).rows[0];
    const receipt = async (extra={}) => {
      const values = {terminal:'HOU',site_code:'5300',site_name:'Houston 5300',sub_location:'MAIN',received_date:'2026-10-15',
        mark:'TEST-'+randomUUID(),shipper:'FIXTURE',bol_bc:88,bale_count:88,warehouse_location:'A1',equipment_type:'V',
        checked_in_at:new Date().toISOString(),verified:true,verified_at:new Date().toISOString(),draft_status:'failed',yard_status:'working',
        material_type:'cotton',movement_direction:'delivery',reference_number:randomUUID(),driver_name:'Fixture Driver',
        trucking_company:'Fixture Carrier',comment_1:'Keep note',bol_photo_path:'fixture/photo.jpg',mcleod_lookup_attempt_id:randomUUID(),
        mcleod_lookup_status:'unresolved',mcleod_lookup_failure_code:'SEARCH_LIMIT_REACHED',mcleod_lookup_failed_at:new Date().toISOString(),
        mcleod_processing_phase:'lookup',...extra};
      const keys=Object.keys(values);
      return (await db.query(`insert into inbound_checkin_rows(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *,updated_at::text as revision`,Object.values(values))).rows[0];
    };
    const finish = (row,key,actor=staff) => db.query('select * from complete_inbound_outside_carrier_auto($1,$2,$3,$4,$5,$6,$7,$8)',
      [row.id,row.terminal,row.site_code,row.revision,row.mcleod_lookup_attempt_id,key,actor.id,actor.user_id]);
    const count = async (table,column,id) => (await db.query(`select count(*)::int n from ${table} where ${column}=$1`,[id])).rows[0].n;
    await t.test('completion retains unresolved evidence and creates one receipt and honest immutable audit',async()=>{
      const row=await receipt(), key=randomUUID(); const saved=(await finish(row,key)).rows[0];
      assert.equal(saved.draft_status,'outside_carrier');assert.equal(saved.yard_status,'completed');
      assert.equal(saved.mcleod_lookup_status,'unresolved');assert.equal(saved.mcleod_processing_phase,'lookup');
      assert.equal(saved.mcleod_lookup_attempt_id,row.mcleod_lookup_attempt_id);
      assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),1);
      const audit=(await db.query('select * from inbound_outside_carrier_events where checkin_id=$1',[row.id])).rows[0];
      assert.match(audit.reason,/fallback applied during staff Finish cotton/);
      assert.match(audit.acknowledgement,/No separate staff acknowledgment was requested or recorded/);
      assert.equal(audit.verification_status,'unresolved');
      for(const field of ['reference_number','driver_name','trucking_company','comment_1','bol_photo_path','checked_in_at']) assert.deepEqual(audit.before_values[field],audit.after_values[field]);
      assert.equal((await finish(row,key)).rows[0].id,row.id,'same request replays despite stale revision');
      assert.equal(await count('inbound_outside_carrier_events','checkin_id',row.id),1);
      assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),1);
      await assert.rejects(finish(row,randomUUID()),/already been completed/);
      await assert.rejects(finish({...row,mcleod_lookup_attempt_id:randomUUID()},key),/already been completed/);
      await assert.rejects(db.query("update inbound_outside_carrier_events set reason='rewritten' where checkin_id=$1",[row.id]),/immutable/);
      await assert.rejects(db.query("update inbound_checkin_rows set yard_status='working' where id=$1",[row.id]),/reconciliation/);
    });
    await t.test('known matches, writes, legacy and active attempts never enter fallback',async()=>{
      for(const extra of [{matched_order_id:'KNOWN'},{matched_order_id:'KNOWN2',matched_stop_id:'STOP'}, {mcleod_lookup_has_known_match:true},
        {mcleod_processing_phase:'write_pending'}, {mcleod_processing_phase:'legacy_review'},
        {mcleod_lookup_attempt_id:null}, {draft_status:'processing'}, {mcleod_lookup_status:'conflict'},
        {mcleod_lookup_failure_code:'UNKNOWN'}, {bale_count:80}, {verified:false}]) {
        const row=await receipt(extra);await assert.rejects(finish(row,randomUUID()));
        assert.equal(await count('inbound_outside_carrier_events','checkin_id',row.id),0);
        assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),0);
      }
    });
    await t.test('stale revisions, attempts, staff and caller permissions reject',async()=>{
      const row=await receipt();
      await assert.rejects(finish({...row,revision:'2000-01-01'},randomUUID()),/changed/);
      await assert.rejects(finish({...row,mcleod_lookup_attempt_id:randomUUID()},randomUUID()),/changed/);
      await assert.rejects(finish(row,randomUUID(),{...staff,user_id:randomUUID()}),/staff access/);
      const privileges=(await db.query("select has_function_privilege('authenticated','complete_inbound_outside_carrier_auto(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid)','execute') a,has_function_privilege('service_role','complete_inbound_outside_carrier_auto(uuid,text,text,timestamptz,uuid,uuid,uuid,uuid)','execute') s")).rows[0];
      assert.deepEqual(privileges,{a:false,s:true});
    });
    await t.test('request ID reuse across arrivals rolls back receipt and completion',async()=>{
      const first=await receipt(),second=await receipt(),key=randomUUID();await finish(first,key);
      await assert.rejects(finish(second,key),/unique constraint/);
      assert.equal(await count('inbound_outside_carrier_events','checkin_id',second.id),0);
      assert.equal(await count('warehouse_inventory_lots','source_checkin_id',second.id),0);
      assert.equal((await db.query('select draft_status from inbound_checkin_rows where id=$1',[second.id])).rows[0].draft_status,'failed');
    });
    await t.test('transaction rollback removes completion, receipt and audit together',async()=>{
      const row=await receipt(),key=randomUUID();await db.exec('begin');await finish(row,key);await db.exec('rollback');
      assert.equal(await count('inbound_outside_carrier_events','checkin_id',row.id),0);
      assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),0);
      assert.equal((await db.query('select draft_status from inbound_checkin_rows where id=$1',[row.id])).rows[0].draft_status,'failed');
      assert.equal((await finish(row,key)).rows[0].yard_status,'completed');
    });
  } finally { await db.close(); }
});
