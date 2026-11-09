import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261109171637_checkin_arrival_sync.sql',import.meta.url),'utf8');
test('arrival queue, claim, identity fence and permissions run in PostgreSQL',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table public.inbound_checkin_rows(id uuid primary key,updated_at timestamptz default now(),checked_in_at timestamptz,
 matched_order_id text,matched_stop_id text,terminal text default 'HOU',site_code text default '5300',site_name text default 'Houston - 5300',
 movement_direction text default 'pickup',material_type text default 'cotton',reference_number text default 'ABC',mark text default 'ABC',
 yard_status text default 'waiting',physical_departed_at timestamptz,local_receiving_only boolean default false,
 outside_carrier_override_at timestamptz,mcleod_processing_phase text,bale_count integer);
 insert into inbound_checkin_rows(id,checked_in_at) values('00000000-0000-0000-0000-000000000001',now());`);
 await db.exec(migration);
 assert.equal((await db.query('select * from inbound_arrival_sync')).rows.length,0,'no historical backfill');
 await db.exec(`insert into inbound_checkin_rows(id,matched_order_id,checked_in_at) values('00000000-0000-0000-0000-000000000002','ORDER1',now());`);
 const id='00000000-0000-0000-0000-000000000002';
 const [{updated_at}]=(await db.query('select updated_at from inbound_checkin_rows where id=$1',[id])).rows;
 const plan={orderId:'ORDER1',stopId:'STOP1'};
 assert.equal((await db.query('select claim_inbound_arrival($1,$2,$3) as claimed',[id,'2000-01-01',plan])).rows[0].claimed,false);
 assert.equal((await db.query('select claim_inbound_arrival($1,$2,$3) as claimed',[id,updated_at,plan])).rows[0].claimed,true);
 assert.equal((await db.query('select claim_inbound_arrival($1,$2,$3) as claimed',[id,updated_at,plan])).rows[0].claimed,false);
 for(const edit of ["checked_in_at=now()+interval '1 hour'","matched_order_id='OTHER'","matched_stop_id='OTHER'","yard_status='completed'","physical_departed_at=now()","mcleod_processing_phase='write_pending'"])
  await assert.rejects(db.query(`update inbound_checkin_rows set ${edit} where id=$1`,[id]));
 await db.query('update inbound_checkin_rows set bale_count=90,matched_stop_id=$2 where id=$1',[id,'STOP1']);
 await db.query("update inbound_arrival_sync set status='synced' where checkin_id=$1",[id]);
 await db.query("update inbound_checkin_rows set physical_departed_at=now(),yard_status='completed' where id=$1",[id]);
 for(const role of ['anon','authenticated']) {
  const [{allowed}]=(await db.query("select has_table_privilege($1,'inbound_arrival_sync','SELECT') as allowed",[role])).rows;assert.equal(allowed,false);
  assert.equal((await db.query("select has_function_privilege($1,'claim_inbound_arrival(uuid,timestamptz,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
 }
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='inbound_arrival_sync'::regclass")).rows[0].relrowsecurity,true);
 } finally {await db.close();}
});
