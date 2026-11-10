import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { publicCheckinRow } from '../lib/inbound/checkin/public-row.ts';

const original = readFileSync(new URL('../supabase/migrations/20261109200524_break_marks_and_daily_arrival_numbers.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261110130302_commodity_daily_numbers.sql', import.meta.url), 'utf8');
test('overall arrivals and separate cotton/domestic numbers persist through checkout, deletion, yards and local midnight', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table inbound_checkin_rows(id uuid primary key default gen_random_uuid(),terminal text not null,site_code text not null,material_type text,checked_in_at timestamptz,created_at timestamptz default now(),yard_status text);`);
    const insert = async (material, time='2026-11-10T08:00:00-06', site='5300', terminal='HOU') =>
      (await db.query("insert into inbound_checkin_rows(terminal,site_code,material_type,checked_in_at,yard_status) values($1,$2,$3,$4,'waiting') returning id", [terminal,site,material,time])).rows[0].id;
    const lumber = await insert('lumber','2026-11-10T07:00:00-06');
    const cotton = await insert('cotton','2026-11-10T07:10:00-06');
    const other = await insert('other','2026-11-10T07:20:00-06');
    await db.exec('begin;'+original.slice(original.indexOf('create table public.warehouse_arrival_counters')));
    const before = (await db.query('select checkin_id,queue_number from warehouse_arrival_numbers order by queue_number')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select checkin_id,queue_number from warehouse_arrival_numbers order by queue_number')).rows, before);
    const number = async id => (await db.query('select queue_number,freight_number,freight_group,queue_day from warehouse_arrival_numbers where checkin_id=$1',[id])).rows[0];
    assert.deepEqual([await number(lumber),await number(cotton),await number(other)].map(r=>[r.queue_number,r.freight_number,r.freight_group]),[[1,1,'domestic'],[2,1,'cotton'],[3,2,'domestic']]);
    await db.query("update inbound_checkin_rows set yard_status='completed' where id=$1",[lumber]);
    await db.query("update inbound_checkin_rows set yard_status='cancelled' where id=$1",[cotton]);
    const fourth=await insert('cotton');
    assert.deepEqual([(await number(fourth)).queue_number,(await number(fourth)).freight_number],[4,2]);
    await db.query('delete from inbound_checkin_rows where id=$1',[fourth]);
    const fifth=await insert('cotton');
    assert.deepEqual([(await number(fifth)).queue_number,(await number(fifth)).freight_number],[5,3]);
    const sixth=await insert('other');
    assert.deepEqual([(await number(sixth)).queue_number,(await number(sixth)).freight_number],[6,3]);
    // UTC midnight is still the previous warehouse day.
    const evening=await insert('lumber','2026-11-11T01:00:00Z');
    assert.equal((await number(evening)).freight_number,4);
    for (const id of [await insert('cotton','2026-11-11T00:01:00-06'), await insert('cotton',undefined,'4331'), await insert('cotton',undefined,'175','SAV')]) {
      assert.deepEqual([(await number(id)).queue_number,(await number(id)).freight_number],[1,1]);
    }
    assert.equal((await number(lumber)).freight_number,1);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from warehouse_freight_counters'),/permission denied/);
    await assert.rejects(db.query('select assign_warehouse_arrival_number()'),/permission denied/);
  } finally { await db.close(); }
});
test('cotton API flattens stored daily numbers without exposing driver or relationship fields', () => {
  const result=publicCheckinRow({id:'cotton-5',driver_name:'Private',arrival_number:[{queue_day:'2026-11-10',queue_number:14,freight_number:5}]});
  assert.equal(result.queue_number,14);assert.equal(result.freight_number,5);
  assert.equal(result.arrival_number,undefined);assert.equal(result.driver_name,undefined);
});
