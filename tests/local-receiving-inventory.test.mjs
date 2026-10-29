import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migrations = new URL('../supabase/migrations/', import.meta.url);
test('local-only King Ranch and other customer receiving creates one cotton receipt without McLeod settlement', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    const names = readdirSync(migrations).filter(n => n.endsWith('.sql')).sort();
    const ordered = [...names.filter(n => Number(n.slice(0,3)) <= 50), ...names.filter(n => n.startsWith('20261027'))];
    for (const name of ordered) await db.exec(readFileSync(new URL(name,migrations),'utf8').replace('create extension if not exists pgcrypto;',''));
    for (const [index,customer] of ['KING RANCH','NEW CUSTOMER'].entries()) {
      const row = (await db.query(`insert into inbound_checkin_rows(terminal,site_code,site_name,mark,shipper,bol_bc,
        checked_in_at,yard_status,draft_status,local_receiving_only,material_type,movement_direction)
        values('SAV','175','Savannah - 175',$1,$2,90,clock_timestamp()-interval '1 hour','working','checked_in',true,'cotton','delivery') returning id`,['LOCAL-'+index,customer])).rows[0];
      await db.query(`update inbound_checkin_rows set received_date=current_date,bale_count=90,warehouse_location='D7',equipment_type='V',
        verified=true,physical_departed_at=clock_timestamp(),yard_status='completed',yard_completed_at=clock_timestamp(),yard_updated_by='fixture' where id=$1`,[row.id]);
      // A repeated save at the DB boundary cannot create a second receipt.
      await db.query('update inbound_checkin_rows set bale_count=bale_count where id=$1',[row.id]);
      const lots=(await db.query('select * from warehouse_inventory_lots where source_checkin_id=$1',[row.id])).rows;
      assert.equal(lots.length,1); assert.equal(lots[0].current_bales,90); assert.equal(lots[0].customer,customer);
      assert.equal((await db.query("select count(*)::int n from warehouse_inventory_events where inventory_lot_id=$1 and event_type='receipt'",[lots[0].id])).rows[0].n,1);
      const saved=(await db.query('select * from inbound_checkin_rows where id=$1',[row.id])).rows[0];
      assert.equal(saved.draft_status,'checked_in'); assert.equal(saved.matched_order_id,null);
      assert.equal(saved.mcleod_processing_phase,null); assert.equal(saved.yard_status,'completed');
      assert.equal((await db.query('select count(*)::int n from inbound_physical_departure_events where checkin_id=$1',[row.id])).rows[0].n,1);
    }
    const lumber=(await db.query(`insert into inbound_checkin_rows(terminal,site_code,site_name,mark,shipper,bale_count,material_type,movement_direction,draft_status)
      values('SAV','1601','Savannah - 1601','NOT-COTTON','LUMBER CUSTOMER',90,'lumber','pickup','processed') returning id`)).rows[0];
    assert.equal((await db.query('select count(*)::int n from warehouse_inventory_lots where source_checkin_id=$1',[lumber.id])).rows[0].n,0);
  } finally { await db.close(); }
});
