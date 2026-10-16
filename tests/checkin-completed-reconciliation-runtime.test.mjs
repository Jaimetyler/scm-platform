import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../supabase/migrations/', import.meta.url);

test('048 embedded PostgreSQL: completed McLeod reconciliation and safety', async t => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && Number(n.slice(0,3)) <= 48).sort()) {
      const sql = readFileSync(new URL(name, migrations), 'utf8').replace('create extension if not exists pgcrypto;', '');
      try { await db.exec(sql); } catch (e) { throw new Error(`${name}: ${e.message}`); }
    }
    const staff = (await db.query(`insert into scm_staff(email,name,role,status,user_id,terminal)
      values ('completed-test@example.test','Fixture','admin','active',gen_random_uuid(),NULL) returning *`)).rows[0];
    const arrival = async (extra={}) => {
      const values = {
        terminal:'HOU',site_code:'5300',site_name:'Houston 5300',sub_location:'MAIN',received_date:'2026-10-15',
        mark:'A0372-'+randomUUID().slice(0,8),shipper:'BUNGE',bol_bc:89,bale_count:89,expected_bale_count:89,
        warehouse_location:'D7',equipment_type:'V',checked_in_at:new Date().toISOString(),
        verified:true,verified_at:new Date().toISOString(),draft_status:'failed',yard_status:'working',
        material_type:'cotton',movement_direction:'delivery',reference_number:randomUUID(),
        driver_name:'Fixture Driver',trucking_company:'Fixture Carrier',
        matched_order_id:'0825141',matched_stop_id:null,
        mcleod_lookup_attempt_id:randomUUID(),mcleod_lookup_status:'conflict',mcleod_processing_phase:'lookup',
        ...extra,
      };
      const keys = Object.keys(values);
      return (await db.query(`insert into inbound_checkin_rows(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *,updated_at::text as revision`,Object.values(values))).rows[0];
    };
    const finish = (row, overrides={}) => db.query(`select * from complete_inbound_mcleod_already_done($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      row.id,row.terminal,row.site_code,overrides.revision??row.revision,
      overrides.order??row.matched_order_id,overrides.stop??'HOU-SO-1',
      overrides.staffId??staff.id,overrides.userId??staff.user_id,
      '2026-10-15T08:15:00-05:00','2026-10-15T09:45:00-05:00',
    ]);
    const count = async (table,column,id) => (await db.query(`select count(*)::int n from ${table} where ${column}=$1`,[id])).rows[0].n;
    await t.test('A0372-style cotton receives 89 bales once at D7 and reconciles yard', async () => {
      const row = await arrival();
      const result = (await finish(row)).rows[0];
      assert.equal(result.draft_status,'processed');
      assert.equal(result.yard_status,'completed');
      assert.equal(result.matched_order_id,'0825141');
      assert.equal(result.matched_stop_id,'HOU-SO-1');
      assert.equal(result.mcleod_processing_phase,'complete');
      const lots = (await db.query(`select * from warehouse_inventory_lots where source_checkin_id=$1`,[row.id])).rows;
      assert.equal(lots.length,1);
      assert.equal(lots[0].original_bales,89);
      assert.equal(lots[0].current_bales,89);
      assert.equal(lots[0].warehouse_location,'D7');
      assert.equal(await count('inbound_mcleod_completed_events','checkin_id',row.id),1);
      const replay=(await finish(row)).rows[0];
      assert.equal(replay.id,row.id);
      assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),1);
      assert.equal(await count('warehouse_inventory_events','inventory_lot_id',lots[0].id),1);
      assert.equal(await count('inbound_mcleod_completed_events','checkin_id',row.id),1);
      await assert.rejects(finish(row,{stop:'DIFFERENT-STOP'}));
      await assert.rejects(db.query(`update inbound_mcleod_completed_events set reason='rewrite' where checkin_id=$1`,[row.id]),/immutable/);
    });
    await t.test('lumber and other close yard without creating cotton inventory', async () => {
      for (const material of ['lumber','other']) {
        const row = await arrival({mark:null,shipper:null,bol_bc:null,bale_count:null,expected_bale_count:null,
          warehouse_location:null,verified:false,material_type:material,movement_direction:'pickup',
          draft_status:'checked_in', matched_order_id:`ORDER-${randomUUID()}`});
        const completed = (await finish(row)).rows[0];
        assert.equal(completed.yard_status,'completed');
        assert.equal(completed.draft_status,'checked_in');
        assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),0);
        assert.equal(await count('inbound_mcleod_completed_events','checkin_id',row.id),1);
      }
    });
    await t.test('invalid identity, stale revision and unfinished/shortage cotton stay blocked', async () => {
      for (const [extra,overrides] of [
        [{}, {order:'OTHER-ORDER'}], [{}, {revision:'2000-01-01T00:00:00Z'}],
        [{}, {staffId:randomUUID()}],
        [{bale_count:80}, {}], [{verified:false}, {}],
        [{warehouse_location:null}, {}], [{mcleod_processing_phase:'write_pending'}, {}],
        [{matched_stop_id:'ORIGINAL-STOP'}, {stop:'DIFFERENT-STOP'}],
      ]) {
        const row=await arrival(extra);
        await assert.rejects(finish(row,overrides));
        assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),0);
        assert.equal(await count('inbound_mcleod_completed_events','checkin_id',row.id),0);
      }
    });
    await t.test('SQL transaction rollback removes inventory, completion and audit', async () => {
      const row=await arrival();
      await db.exec('begin');
      await finish(row);
      await db.exec('rollback');
      assert.equal(await count('warehouse_inventory_lots','source_checkin_id',row.id),0);
      assert.equal(await count('inbound_mcleod_completed_events','checkin_id',row.id),0);
      assert.equal((await db.query('select draft_status,yard_status from inbound_checkin_rows where id=$1',[row.id])).rows[0].draft_status,'failed');
    });
    await t.test('RPC not available to ordinary authenticated users', async () => {
      const result=(await db.query(`select has_function_privilege('authenticated','complete_inbound_mcleod_already_done(uuid,text,text,timestamptz,text,text,uuid,uuid,text,text)','execute') a,
      has_function_privilege('service_role','complete_inbound_mcleod_already_done(uuid,text,text,timestamptz,text,text,uuid,uuid,text,text)','execute') s`)).rows[0];
      assert.deepEqual(result,{a:false,s:true});
    });
  } finally { await db.close(); }
});
